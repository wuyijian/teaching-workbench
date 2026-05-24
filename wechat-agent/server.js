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
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

// ── 持久化配置（config.json） ─────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

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

// ── weclaw 健康监控状态（内存） ───────────────────────────────────────────────
const weclawHealth = {
  lastChecked: null,   // ISO 字符串，上次检查时间
  autoRestartCount: 0, // 自动重启次数
  sessionExpired: false,
  weclawRunning: false,
};

/** 检查 weclaw 进程状态，必要时自动重启，并扫描日志中的 session 过期关键词 */
function checkWeclawHealth() {
  weclawHealth.lastChecked = new Date().toISOString();

  exec('pm2 jlist', { timeout: 5000 }, (err, stdout) => {
    let pm2Running = false;
    if (!err) {
      try {
        const list = JSON.parse(stdout || '[]');
        const proc = list.find(p => p.name === 'weclaw');
        pm2Running = proc?.pm2_env?.status === 'online';
      } catch { /* ignore parse errors */ }
    }

    if (!pm2Running) {
      weclawHealth.weclawRunning = false;
      // 尝试自动重启（仅当 pm2 知道此进程时有效，否则静默失败）
      exec('pm2 restart weclaw 2>/dev/null', { timeout: 10000 }, (restartErr) => {
        if (!restartErr) {
          weclawHealth.autoRestartCount++;
          weclawHealth.weclawRunning = true;
          console.log(`[health] ✅ weclaw 自动重启成功（第 ${weclawHealth.autoRestartCount} 次）`);
        } else {
          console.warn('[health] ⚠️ weclaw 自动重启失败（进程可能未被 pm2 管理）:', restartErr.message);
        }
      });
    } else {
      weclawHealth.weclawRunning = true;
      // 读最新日志，检测 session 过期关键词
      exec('pm2 logs weclaw --lines 100 --nostream 2>&1', { timeout: 8000 }, (logErr, logOut) => {
        if (logErr || !logOut) return;
        const text = logOut.toString();
        const expired = /session.?expired|login.?required|need.?re.?login|需要重新登录|session\s*失效|re.?login/i.test(text);
        if (expired !== weclawHealth.sessionExpired) {
          console.log(`[health] session 过期状态变更 → ${expired}`);
          weclawHealth.sessionExpired = expired;
        }
      });
    }
  });
}

// 启动 15 秒后做第一次健康检查，此后每 60 秒检查一次
setTimeout(checkWeclawHealth, 15 * 1000);
setInterval(checkWeclawHealth, 60 * 1000);

// ── 健康检查 ──────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, service: 'wechat-agent' }));

// ── 多用户绑定：生成绑定码 ────────────────────────────────────────────────────
// GET /generate-bind-code?userId=<supabase_user_id>
// 返回 { ok: true, code: "ABC123", expiresAt: 1234567890 }
app.get('/generate-bind-code', (req, res) => {
  const { userId } = req.query;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ ok: false, error: '参数缺失: userId' });
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];

  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 分钟
  const cfg = readConfig();
  if (!cfg.pendingCodes) cfg.pendingCodes = {};
  if (!cfg.bindings) cfg.bindings = {};

  // 清理已过期的绑定码
  for (const [k, v] of Object.entries(cfg.pendingCodes)) {
    if (v.expiresAt < Date.now()) delete cfg.pendingCodes[k];
  }
  cfg.pendingCodes[code] = { userId, expiresAt };
  writeConfig(cfg);
  console.log(`[generate-bind-code] 生成绑定码 ${code} → userId=${userId}（10分钟有效）`);
  return res.json({ ok: true, code, expiresAt });
});

// ── 多用户绑定：查询绑定状态 ──────────────────────────────────────────────────
// GET /bind-status?userId=<supabase_user_id>
// 返回 { bound: true/false, wechatName?: "..." }
app.get('/bind-status', (req, res) => {
  const { userId } = req.query;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ ok: false, error: '参数缺失: userId' });
  }
  const cfg = readConfig();
  const wechatName = cfg.bindings?.[userId];
  return res.json({ bound: !!wechatName, wechatName: wechatName || undefined });
});

// ── 主动推送接口：Web 端一键同步反馈到微信 ────────────────────────────────────
// POST /send  { to: "家长微信备注名", message: "消息正文" }
// 需要环境变量 WECLAW_SEND_URL（ClawBot 主动推送地址）；
// 可选 WECLAW_API_TOKEN（Bearer 鉴权）。

/** 复用 /send 逻辑向指定备注名发送消息 */
async function sendToContact(to, message) {
  const sendUrl = process.env.WECLAW_SEND_URL;
  if (!sendUrl) {
    throw Object.assign(new Error('未配置主动推送服务（WECLAW_SEND_URL）'), { status: 503 });
  }
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.WECLAW_API_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.WECLAW_API_TOKEN}`;
  }
  const resp = await fetch(sendUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ to, msg_type: 'text', content: message }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw Object.assign(new Error(`发送服务返回错误 ${resp.status}`), { status: 502, detail: errText.slice(0, 200) });
  }
  const data = await resp.json().catch(() => ({}));
  return data.ok !== false;
}

app.post('/send', async (req, res) => {
  const { to, message } = req.body || {};
  if (!to || !message) {
    return res.status(400).json({ ok: false, error: '参数缺失：需要 to（微信备注名）和 message（消息内容）' });
  }
  if (!process.env.WECLAW_SEND_URL) {
    console.warn('[wechat-agent/send] WECLAW_SEND_URL 未配置，无法主动推送');
    return res.status(503).json({ ok: false, error: '未配置主动推送服务（WECLAW_SEND_URL），请在服务器 .env 中添加此变量' });
  }
  try {
    const ok = await sendToContact(to, message);
    console.log(`[wechat-agent/send] ✅ 已发送 → ${to}（${message.length} 字）`);
    return res.json({ ok });
  } catch (err) {
    console.error('[wechat-agent/send] 发送失败:', err.message);
    return res.status(err.status ?? 502).json({ ok: false, error: err.message });
  }
});

// POST /send-self  { message: "消息正文", userId?: "supabase_user_id" }
// 将消息发给与 userId 绑定的微信账号。
// 若传 userId 则优先查 config.bindings[userId]；兜底用旧的 selfNickname / env 变量。
app.post('/send-self', async (req, res) => {
  const { message, userId } = req.body || {};
  if (!message) {
    return res.status(400).json({ ok: false, error: '参数缺失：需要 message（消息内容）' });
  }

  const cfg = readConfig();

  // 旧 teacher_open_id 向后兼容迁移（仅在 bindings 中不存在时执行一次）
  if (cfg.teacher_open_id && !(cfg.bindings?.legacy)) {
    if (!cfg.bindings) cfg.bindings = {};
    cfg.bindings.legacy = cfg.teacher_open_id;
    writeConfig(cfg);
  }

  // 优先用多用户绑定关系查找；否则 fallback 到旧 selfNickname / env 变量
  let selfNickname = null;
  if (userId && cfg.bindings?.[userId]) {
    selfNickname = cfg.bindings[userId];
  } else if (!userId) {
    selfNickname = cfg.selfNickname || process.env.WECLAW_SELF_NICKNAME || null;
  }

  if (!selfNickname) {
    const hint = userId
      ? `userId=${userId} 未绑定微信，请先通过绑定码完成绑定`
      : '未绑定老师账号。请在微信向 ClawBot 发送「绑定 <绑定码>」完成绑定';
    console.warn(`[wechat-agent/send-self] ${hint}`);
    return res.json({ ok: false, error: hint });
  }
  if (!process.env.WECLAW_SEND_URL) {
    console.warn('[wechat-agent/send-self] WECLAW_SEND_URL 未配置，无法推送');
    return res.status(503).json({ ok: false, error: '未配置主动推送服务（WECLAW_SEND_URL）' });
  }
  try {
    const ok = await sendToContact(selfNickname, message);
    console.log(`[wechat-agent/send-self] ✅ 已发给（${selfNickname}），${message.length} 字`);
    return res.json({ ok });
  } catch (err) {
    console.error('[wechat-agent/send-self] 发送失败:', err.message);
    return res.status(err.status ?? 502).json({ ok: false, error: err.message });
  }
});

// ── 绑定状态查询（旧接口，向后兼容） ─────────────────────────────────────────
// GET /self-status → { bound: bool, nickname: string|null, source: "config"|"env"|null }
app.get('/self-status', (_req, res) => {
  const cfg = readConfig();
  const configNickname = cfg.selfNickname;
  const envNickname    = process.env.WECLAW_SELF_NICKNAME;
  if (configNickname) {
    return res.json({ bound: true, nickname: configNickname, source: 'config' });
  }
  if (envNickname) {
    return res.json({ bound: true, nickname: envNickname, source: 'env' });
  }
  return res.json({ bound: false, nickname: null, source: null });
});

// ── weclaw 控制端点鉴权中间件 ─────────────────────────────────────────────────
// 若服务器配置了 WECLAW_API_TOKEN，则要求 Authorization: Bearer <token>；
// 未配置时允许所有来自反代内网的请求（wechat-agent 只监听 127.0.0.1）。
function requireApiToken(req, res, next) {
  const token = process.env.WECLAW_API_TOKEN;
  if (!token) return next();
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${token}`) {
    return res.status(401).json({ ok: false, error: '未授权，请提供正确的 WECLAW_API_TOKEN' });
  }
  next();
}

// weclaw login 时写入的临时二维码文件路径（如 weclaw 支持 --qr-file 参数）
const WECLAW_QR_FILE = path.join(os.tmpdir(), 'weclaw-qr.png');

// ── GET /weclaw-status ────────────────────────────────────────────────────────
// 返回 { running, loggedIn, nickname, sessionExpired, lastChecked, autoRestartCount }
app.get('/weclaw-status', requireApiToken, (req, res) => {
  /** 将健康监控字段附加到响应 payload */
  function withHealth(base) {
    return {
      ...base,
      sessionExpired:    weclawHealth.sessionExpired,
      lastChecked:       weclawHealth.lastChecked,
      autoRestartCount:  weclawHealth.autoRestartCount,
    };
  }

  exec('pm2 jlist', { timeout: 5000 }, (err, stdout) => {
    let pm2Running = false;
    if (!err) {
      try {
        const list = JSON.parse(stdout || '[]');
        const proc = list.find(p => p.name === 'weclaw');
        pm2Running = proc?.pm2_env?.status === 'online';
      } catch { /* ignore parse errors */ }
    }

    if (pm2Running) {
      // pm2 进程在线：读取 pm2 日志判断是否已登录 / session 是否过期
      exec('pm2 logs weclaw --lines 100 --nostream 2>&1', { timeout: 8000 }, (err2, out2) => {
        if (err2 || !out2) {
          return res.json(withHealth({ running: true, loggedIn: true, nickname: null }));
        }
        const text = out2.toString();
        const loggedIn    = /logged.?in|login.?success|已登录|扫码成功|connected/i.test(text);
        const waitingScan = /waiting.?for.?scan|scan.?this.?qr|等待扫码/i.test(text);
        const expired     = /session.?expired|login.?required|need.?re.?login|需要重新登录|session\s*失效|re.?login/i.test(text);
        const nicknameMatch = text.match(/(?:nickname|昵称|name)[:\s]+([^\n\r]+)/i);
        const nickname    = nicknameMatch?.[1]?.trim() || null;
        const finalLoggedIn = loggedIn || (!waitingScan);
        // 同步更新内存健康状态
        weclawHealth.weclawRunning  = true;
        weclawHealth.sessionExpired = expired;
        return res.json(withHealth({ running: true, loggedIn: finalLoggedIn, nickname }));
      });
      return; // 等待 pm2 logs 回调
    }

    // pm2 中没有 weclaw —— 检查是否存在游离进程
    exec("pgrep -f 'weclaw' 2>/dev/null || ps aux 2>/dev/null | grep -v grep | grep weclaw | awk '{print $2}'", { timeout: 5000 }, (pgrepErr, pgrepOut) => {
      const pids = (pgrepOut || '').trim().split('\n').filter(Boolean);
      if (pids.length > 0) {
        console.log(`[weclaw-status] 检测到游离 weclaw 进程（pids: ${pids.join(',')}），非 pm2 管理`);
        weclawHealth.weclawRunning = true;
        return res.json(withHealth({ running: true, loggedIn: true, nickname: null }));
      }
      weclawHealth.weclawRunning = false;
      return res.json(withHealth({ running: false, loggedIn: false, nickname: null }));
    });
  });
});

// ── POST /weclaw-restart ──────────────────────────────────────────────────────
// 重启 weclaw 并尝试捕获二维码。
// 返回：
//   { ok: true,  type: 'url',    qr: 'https://...' }      微信登录 URL（前端展示为图片）
//   { ok: true,  type: 'image',  qr: 'data:image/png;base64,...' } 二维码图片
//   { ok: false, type: 'manual', message: '...' }           无法自动获取，给出引导文字
app.post('/weclaw-restart', requireApiToken, (req, res) => {
  // 先删除已有的 weclaw pm2 进程（忽略错误）
  exec('pm2 delete weclaw 2>/dev/null || true', { timeout: 10000 }, () => {
    // 清理上次残留的二维码文件
    try { fs.unlinkSync(WECLAW_QR_FILE); } catch { /* 不存在时忽略 */ }

    let output = '';
    let responded = false;
    let qrRespondedOk = false;
    let daemonized = false;
    let timeoutId;

    // weclaw login 直接输出 "QR URL: https://..." 到 stdout，捕获即可
    const args = ['login'];
    const weclawProc = spawn('weclaw', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false, // 保持绑定，以便继续监听登录完成事件
    });

    function respond(payload) {
      if (responded) return;
      responded = true;
      clearTimeout(timeoutId);
      res.json(payload);
    }

    function checkForQr() {
      // 匹配 weclaw 输出的 "QR URL: https://..." 行
      const urlMatch = output.match(/QR URL:\s*(https?:\/\/[^\s]+)/);
      if (urlMatch) {
        qrRespondedOk = true;
        respond({ ok: true, type: 'url', qr: urlMatch[1] });
        return true;
      }
      // 兜底：任意 liteapp.weixin.qq.com URL（无前缀标签时）
      const fallbackMatch = output.match(/https?:\/\/liteapp\.weixin\.qq\.com\/[^\s]+/);
      if (fallbackMatch) {
        qrRespondedOk = true;
        respond({ ok: true, type: 'url', qr: fallbackMatch[0] });
        return true;
      }
      return false;
    }

    function checkForLoginSuccess() {
      // 检测登录成功关键词
      return /logged.?in|login.?success|successfully|已登录|扫码成功|connected/i.test(output);
    }

    function daemonizeWeclaw() {
      if (daemonized) return;
      daemonized = true;
      console.log('[weclaw-restart] 检测到登录成功，将 weclaw 纳入 pm2 管理...');
      // 先结束 login 子进程，再通过 pm2 以守护进程方式启动 weclaw
      try { weclawProc.kill(); } catch { /* 进程可能已退出 */ }
      exec('pm2 start weclaw --name weclaw --max-restarts 3 --restart-delay 5000 -- start && pm2 save', { timeout: 15000 }, (err, stdout, stderr) => {
        if (err) {
          console.error('[weclaw-restart] pm2 start 失败:', err.message, stderr);
        } else {
          console.log('[weclaw-restart] ✅ weclaw 已作为 pm2 守护进程启动');
        }
      });
    }

    function onData(data) {
      output += data.toString();
      if (!checkForQr() && !qrRespondedOk) {
        // 还没获取到 QR，继续等待
        return;
      }
      // QR 已发出，继续监听登录完成
      if (qrRespondedOk && checkForLoginSuccess()) {
        daemonizeWeclaw();
      }
    }

    weclawProc.stdout.on('data', onData);
    weclawProc.stderr.on('data', onData);

    weclawProc.on('error', err => {
      respond({
        ok: false,
        type: 'manual',
        message: `无法启动 weclaw（${err.message}）。请在服务器上手动运行：weclaw login`,
      });
    });

    // 进程意外退出时，若尚未响应则给出兜底回复
    weclawProc.on('exit', (code) => {
      console.log(`[weclaw-restart] weclaw login 进程退出，code=${code}`);
      respond({
        ok: false,
        type: 'manual',
        message: '未能自动获取二维码。请在服务器上手动运行：weclaw login，扫码后点击「检查连接状态」。',
      });
    });

    // 15 秒超时：二维码通常在启动后 1-3 秒出现
    timeoutId = setTimeout(() => {
      if (!checkForQr()) {
        respond({
          ok: false,
          type: 'manual',
          message: '未能自动获取二维码。请在服务器上手动运行：weclaw login，扫码后点击「检查连接状态」。',
        });
      }
    }, 15000);
  });
});

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

  // weclaw 把发送者昵称放在 messages[last].name；top-level user 字段作为兜底
  const lastUserMsg = [...(messages || [])].reverse().find(m => m.role === 'user');
  const userMessage  = lastUserMsg?.content || '';
  // name 字段即微信昵称，与 sendToContact 的 to 字段格式一致（备注名/昵称）
  const senderName   = lastUserMsg?.name || user || 'unknown';

  console.log(`[req] stream=${!!stream} sender=${senderName} msg="${String(userMessage).slice(0, 80)}"`);

  // 简单白名单鉴权（按 top-level user 字段）
  if (ALLOWED_OPENIDS.length > 0 && user && !ALLOWED_OPENIDS.includes(user)) {
    return res.status(403).json({ error: { message: '无权限使用本服务' } });
  }

  try {
    const result = await handleMessage(userMessage, senderName);

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

  // 多用户绑定码：「绑定 ABC123」
  const bindCodeMatch = cmd.match(/^绑定\s*([A-Z0-9]{6})$/i);
  if (bindCodeMatch) {
    const code = bindCodeMatch[1].toUpperCase();
    const cfg = readConfig();
    const pending = cfg.pendingCodes?.[code];
    if (!pending) {
      return '❌ 绑定码无效或已过期，请在工作台重新获取绑定码。';
    }
    if (pending.expiresAt < Date.now()) {
      delete cfg.pendingCodes[code];
      writeConfig(cfg);
      return '❌ 绑定码已过期（有效期10分钟），请在工作台重新获取。';
    }
    if (!cfg.bindings) cfg.bindings = {};
    cfg.bindings[pending.userId] = userId; // userId 此处为 WeChat 显示名，用于后续发送
    delete cfg.pendingCodes[code];
    writeConfig(cfg);
    console.log(`[wechat-agent/bind-code] ✅ 绑定成功: supabaseId=${pending.userId} → wechat=${userId}`);
    return '✅ 绑定成功！您的微信已与教学工作台账号关联。后续反馈通知将发送到此微信。';
  }

  // 绑定老师账号（旧指令，向后兼容）：把发送者（userId）保存到 config.json
  if (/^(绑定老师|\/bind)$/i.test(cmd)) {
    const cfg = readConfig();
    cfg.selfNickname = userId;
    writeConfig(cfg);
    console.log(`[wechat-agent/bind] ✅ 已绑定老师账号: ${userId}`);
    return `✅ 绑定成功！后续反馈通知将发送到您的微信。\n（绑定账号：${userId}）`;
  }

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
    ? '你是一位语文教学助手，帮助老师分析学生课堂表现，生成专业的家长反馈报告。反馈要具体、正向、有建设性，适合直接发给家长查看。严禁使用任何 Markdown 语法（包括 **粗体**、# 标题、- 列表、> 引用、`代码` 等），只输出纯文字段落，用中文序号（一、二、三）分段。'
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
      temperature: 1,
      max_tokens: 2000,
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    console.error(`[kimi] ${resp.status}:`, errBody.slice(0, 300));
    throw new Error(`LLM API error: ${resp.status} ${errBody.slice(0, 100)}`);
  }
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

请从以下维度分析，使用中文序号（一、二、三）分段，每段之间空一行：
一、课堂参与度与专注度
二、知识掌握情况
三、语言表达与理解能力
四、值得表扬的亮点
五、下一步学习建议

反馈语气要温暖、专业，适合直接发送给家长。严禁使用任何 Markdown 语法（包括 **粗体**、# 标题、- 列表、> 引用、\`代码\` 等），只输出纯文字。`;
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
• 绑定 XXXXXX — 输入工作台生成的6位绑定码完成账号绑定
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
