/**
 * Teaching Workbench — WeChat ClawBot Agent Server
 *
 * 暴露一个 OpenAI-compatible Chat Completions 端点，
 * weclaw 以 HTTP 模式连接此服务，把老师发来的微信消息转发过来，
 * 我们查 Supabase、调讯飞/Kimi，把结果以流式 SSE 返回给 weclaw。
 *
 * 启动: node server.js
 * 端口: 18080 (Nginx 反代 /wechat-agent/ → http://127.0.0.1:18080/)
 */

require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '50mb' }));

// ── 环境变量 ──────────────────────────────────────────────────────────────────
const PORT             = process.env.PORT || 18080;
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY; // service_role key（有写权限）
const LLM_API_KEY      = process.env.LLM_API_KEY;
const LLM_BASE_URL     = process.env.LLM_BASE_URL || 'https://api.moonshot.cn/v1';
const LLM_MODEL        = process.env.LLM_MODEL    || 'kimi-k2.5';
const XF_APP_ID        = process.env.XF_APP_ID;
const XF_ACCESS_KEY_ID = process.env.XF_ACCESS_KEY_ID;
const XF_ACCESS_KEY_SECRET = process.env.XF_ACCESS_KEY_SECRET;
// 可选：白名单（多个 openid 用逗号分隔），留空则允许所有人
const ALLOWED_OPENIDS  = (process.env.ALLOWED_OPENIDS || '').split(',').filter(Boolean);

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

// ── 健康检查 ──────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, service: 'wechat-agent' }));

// ── 模型列表（weclaw 会查这个接口） ──────────────────────────────────────────
app.get('/v1/models', (_req, res) => {
  res.json({
    object: 'list',
    data: [{ id: 'teaching-workbench', object: 'model', created: Date.now(), owned_by: 'local' }],
  });
});

// ── 主接口：OpenAI-compatible Chat Completions ────────────────────────────────
app.post('/v1/chat/completions', async (req, res) => {
  const { messages, stream, user } = req.body;

  // 简单白名单鉴权
  if (ALLOWED_OPENIDS.length > 0 && user && !ALLOWED_OPENIDS.includes(user)) {
    return res.status(403).json({ error: { message: '无权限使用本服务' } });
  }

  try {
    const userMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const result = await handleMessage(userMessage, user || 'unknown');

    if (stream) {
      // SSE 流式响应
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const chunks = chunkString(result, 30);
      for (const chunk of chunks) {
        const data = { id: 'chatcmpl-wx', object: 'chat.completion.chunk', model: LLM_MODEL,
          choices: [{ delta: { content: chunk }, index: 0, finish_reason: null }] };
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        await sleep(20);
      }
      res.write(`data: [DONE]\n\n`);
      res.end();
    } else {
      res.json({
        id: 'chatcmpl-wx', object: 'chat.completion', model: LLM_MODEL, created: Date.now(),
        choices: [{ message: { role: 'assistant', content: result }, index: 0, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }
  } catch (err) {
    console.error('[agent] error:', err);
    const msg = '服务出错，请稍后重试。';
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      const data = { id: 'chatcmpl-wx', object: 'chat.completion.chunk', model: LLM_MODEL,
        choices: [{ delta: { content: msg }, index: 0, finish_reason: 'stop' }] };
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.json({ id: 'chatcmpl-wx', object: 'chat.completion', model: LLM_MODEL, created: Date.now(),
        choices: [{ message: { role: 'assistant', content: msg }, index: 0, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
    }
  }
});

// ── 消息分发逻辑 ──────────────────────────────────────────────────────────────
async function handleMessage(text, userId) {
  const cmd = text.trim();

  // ── 指令路由 ─────────────────────────────────────────────────────────────
  if (/^(帮助|help|\?|？)$/i.test(cmd)) {
    return HELP_TEXT;
  }

  if (/^(任务列表|最近任务|我的任务|查任务)$/.test(cmd)) {
    return await cmdListTasks();
  }

  if (/^查[学生]?\s*(.+)$/.test(cmd)) {
    const match = cmd.match(/^查[学生]?\s*(.+)$/);
    return await cmdQueryStudent(match[1].trim());
  }

  if (/^(今日|今天)(任务|转写|摘要)?$/.test(cmd)) {
    return await cmdTodayTasks();
  }

  if (/^(待反馈|未反馈|需要反馈)$/.test(cmd)) {
    return await cmdPendingFeedback();
  }

  if (/^生成反馈\s+(.+)$/.test(cmd)) {
    const match = cmd.match(/^生成反馈\s+(.+)$/);
    return await cmdGenerateFeedback(match[1].trim());
  }

  if (/^(统计|数据|本周统计)$/.test(cmd)) {
    return await cmdStats();
  }

  // ── 通用 AI 问答（透传 Kimi） ────────────────────────────────────────────
  return await callKimi(cmd);
}

// ── 指令：任务列表 ────────────────────────────────────────────────────────────
async function cmdListTasks() {
  if (!supabase) return '⚠️ 数据库未配置';

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('tasks')
    .select('id, student_name, topic, status, created_at, ai_summary')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) return `查询失败：${error.message}`;
  if (!data?.length) return '最近 7 天没有转写任务。';

  const lines = data.map((t, i) => {
    const status = STATUS_LABEL[t.status] || t.status;
    const date = new Date(t.created_at).toLocaleDateString('zh-CN');
    const hasFeedback = t.ai_summary ? '✅' : '⬜';
    return `${i + 1}. ${hasFeedback} ${t.student_name}｜${t.topic || '未填主题'}｜${status}｜${date}`;
  });

  return `📋 **最近 7 天任务**（共 ${data.length} 条）\n\n${lines.join('\n')}\n\n✅=已生成反馈 ⬜=待生成\n\n发送「生成反馈 姓名」可生成 AI 反馈`;
}

// ── 指令：今日任务 ────────────────────────────────────────────────────────────
async function cmdTodayTasks() {
  if (!supabase) return '⚠️ 数据库未配置';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from('tasks')
    .select('student_name, topic, status, ai_summary')
    .gte('created_at', today.toISOString())
    .order('created_at', { ascending: false });

  if (error) return `查询失败：${error.message}`;
  if (!data?.length) return '今天还没有转写任务。';

  const done = data.filter(t => t.status === 'done').length;
  const withFeedback = data.filter(t => t.ai_summary).length;
  const lines = data.map(t => {
    const status = STATUS_LABEL[t.status] || t.status;
    const fb = t.ai_summary ? '✅' : '⬜';
    return `${fb} ${t.student_name}｜${t.topic || '—'}｜${status}`;
  });

  return `📅 **今日任务**（共 ${data.length} 条）\n转写完成 ${done} 条，已有反馈 ${withFeedback} 条\n\n${lines.join('\n')}`;
}

// ── 指令：待反馈 ──────────────────────────────────────────────────────────────
async function cmdPendingFeedback() {
  if (!supabase) return '⚠️ 数据库未配置';

  const { data, error } = await supabase
    .from('tasks')
    .select('student_name, topic, created_at')
    .eq('status', 'done')
    .is('ai_summary', null)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) return `查询失败：${error.message}`;
  if (!data?.length) return '🎉 所有已完成任务都有 AI 反馈了！';

  const lines = data.map((t, i) => {
    const date = new Date(t.created_at).toLocaleDateString('zh-CN');
    return `${i + 1}. ${t.student_name}｜${t.topic || '未填主题'}｜${date}`;
  });

  return `⬜ **待生成 AI 反馈**（${data.length} 条）\n\n${lines.join('\n')}\n\n发送「生成反馈 姓名」生成对应学生的反馈`;
}

// ── 指令：查学生 ──────────────────────────────────────────────────────────────
async function cmdQueryStudent(studentName) {
  if (!supabase) return '⚠️ 数据库未配置';

  const { data, error } = await supabase
    .from('tasks')
    .select('topic, status, created_at, ai_summary, notes')
    .ilike('student_name', `%${studentName}%`)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) return `查询失败：${error.message}`;
  if (!data?.length) return `未找到学生「${studentName}」的记录。`;

  const lines = data.map((t, i) => {
    const date = new Date(t.created_at).toLocaleDateString('zh-CN');
    const status = STATUS_LABEL[t.status] || t.status;
    const fb = t.ai_summary ? `\n   反馈摘要：${t.ai_summary.slice(0, 60)}...` : '';
    return `${i + 1}. ${t.topic || '未填主题'}｜${status}｜${date}${fb}`;
  });

  return `👤 **${studentName}** 最近 ${data.length} 条记录\n\n${lines.join('\n\n')}`;
}

// ── 指令：生成反馈 ────────────────────────────────────────────────────────────
async function cmdGenerateFeedback(studentName) {
  if (!supabase) return '⚠️ 数据库未配置';
  if (!LLM_API_KEY) return '⚠️ LLM API Key 未配置';

  // 查找最近一条已完成但无反馈的任务
  const { data, error } = await supabase
    .from('tasks')
    .select('id, student_name, topic, segments, notes')
    .ilike('student_name', `%${studentName}%`)
    .eq('status', 'done')
    .is('ai_summary', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) return `查询失败：${error.message}`;
  if (!data?.length) return `未找到「${studentName}」待生成反馈的任务（可能已生成过，或任务未完成）。`;

  const task = data[0];
  const transcript = formatTranscript(task.segments);
  if (!transcript) return `「${studentName}」的转写内容为空，无法生成反馈。`;

  const prompt = buildFeedbackPrompt(task.student_name, task.topic, transcript, task.notes);

  try {
    const feedback = await callKimi(prompt, true);

    // 保存反馈到 Supabase
    await supabase.from('tasks').update({ ai_summary: feedback, ai_saved_at: new Date().toISOString() })
      .eq('id', task.id);

    return `✅ **${task.student_name}** 的 AI 反馈已生成并保存：\n\n${feedback.slice(0, 800)}${feedback.length > 800 ? '\n\n…（完整内容已保存到工作台）' : ''}`;
  } catch (e) {
    return `生成反馈失败：${e.message}`;
  }
}

// ── 指令：统计 ────────────────────────────────────────────────────────────────
async function cmdStats() {
  if (!supabase) return '⚠️ 数据库未配置';

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ count: total }, { count: done }, { count: withFeedback }] = await Promise.all([
    supabase.from('tasks').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo),
    supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'done').gte('created_at', weekAgo),
    supabase.from('tasks').select('*', { count: 'exact', head: true }).not('ai_summary', 'is', null).gte('created_at', weekAgo),
  ]);

  return `📊 **本周数据统计**\n\n转写任务：${total ?? 0} 条\n转写完成：${done ?? 0} 条\n已生成反馈：${withFeedback ?? 0} 条\n待生成反馈：${(done ?? 0) - (withFeedback ?? 0)} 条`;
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────
async function callKimi(userMsg, isSystemRole = false) {
  if (!LLM_API_KEY) return '⚠️ LLM API Key 未配置，无法回答问题。';

  const systemPrompt = isSystemRole
    ? '你是一位语文教学助手，帮助老师分析学生课堂表现，生成专业的家长反馈报告。反馈要具体、正向、有建设性，适合直接发给家长查看。'
    : '你是语文教学工作台的微信助手。你可以帮助老师查询学生转写任务、生成教学反馈、统计工作数据。用简洁的中文回答，重要信息用 emoji 标记。如果问题超出教学范畴，也可以作为通用 AI 助手回答。';

  const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${LLM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!resp.ok) throw new Error(`LLM API error: ${resp.status}`);
  const json = await resp.json();
  return json.choices?.[0]?.message?.content || '无回复';
}

function formatTranscript(segments) {
  if (!segments?.length) return '';
  return segments
    .map(s => {
      const speaker = s.speaker ? `[${s.speaker}] ` : '';
      return `${speaker}${s.text}`;
    })
    .join('\n');
}

function buildFeedbackPrompt(studentName, topic, transcript, notes) {
  return `请为以下语文课堂转写内容生成一份家长反馈报告。

学生：${studentName}
主题：${topic || '未指定'}
${notes ? `老师备注：${notes}` : ''}

课堂转写内容：
${transcript.slice(0, 3000)}

请从以下维度分析：
1. 课堂参与度与专注度
2. 知识掌握情况
3. 语言表达与理解能力
4. 值得表扬的亮点
5. 下一步学习建议

反馈语气要温暖、专业，适合直接发送给家长。`;
}

function chunkString(str, size) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) chunks.push(str.slice(i, i + size));
  return chunks;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const STATUS_LABEL = {
  queued: '排队中', uploading: '上传中', transcribing: '转写中', done: '完成', error: '失败',
};

const HELP_TEXT = `🤖 **语文教学工作台助手**

**支持的指令：**
• 任务列表 — 查看最近 7 天转写任务
• 今日任务 — 查看今天的任务
• 待反馈 — 列出未生成反馈的任务
• 查 姓名 — 查看某位学生的记录
• 生成反馈 姓名 — AI 生成并保存反馈
• 统计 — 本周数据统计

**其他问题直接发送**，我会用 AI 回答。

工作台网址：https://yixiaojian.top`;

// ── 启动 ──────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[wechat-agent] 启动成功 → http://127.0.0.1:${PORT}`);
  console.log(`[wechat-agent] Supabase: ${supabase ? '✅ 已连接' : '⚠️ 未配置'}`);
  console.log(`[wechat-agent] LLM: ${LLM_API_KEY ? `✅ ${LLM_MODEL}` : '⚠️ 未配置'}`);
});
