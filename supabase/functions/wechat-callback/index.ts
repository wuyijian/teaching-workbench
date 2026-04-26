/**
 * Supabase Edge Function: wechat-callback
 *
 * 职责：
 *  1. 接收前端传来的微信授权 code
 *  2. 向微信 API 换取 access_token + openid
 *  3. 获取微信用户信息（昵称、头像）
 *  4. 在 Supabase 中查找或创建对应账号
 *  5. 生成 magic-link token 返回给前端，前端再调 verifyOtp 完成登录
 *
 * 环境变量（在 Supabase Dashboard → Edge Functions → Secrets 中配置）：
 *  WECHAT_APP_ID       - 微信开放平台 AppID
 *  WECHAT_APP_SECRET   - 微信开放平台 AppSecret
 *  SUPABASE_URL        - 自动注入
 *  SUPABASE_SERVICE_ROLE_KEY - 自动注入
 */

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WECHAT_APP_ID     = Deno.env.get('WECHAT_APP_ID')!;
const WECHAT_APP_SECRET = Deno.env.get('WECHAT_APP_SECRET')!;
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

interface WxTokenResp {
  access_token?: string;
  openid?: string;
  errcode?: number;
  errmsg?: string;
}

interface WxUserResp {
  openid:      string;
  nickname:    string;
  headimgurl:  string;
  errcode?:    number;
  errmsg?:     string;
}

async function wxGetToken(code: string): Promise<WxTokenResp> {
  const url = `https://api.weixin.qq.com/sns/oauth2/access_token` +
    `?appid=${WECHAT_APP_ID}&secret=${WECHAT_APP_SECRET}` +
    `&code=${code}&grant_type=authorization_code`;
  const res = await fetch(url);
  return res.json();
}

async function wxGetUserInfo(accessToken: string, openid: string): Promise<WxUserResp> {
  const url = `https://api.weixin.qq.com/sns/userinfo` +
    `?access_token=${accessToken}&openid=${openid}&lang=zh_CN`;
  const res = await fetch(url);
  return res.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const { code } = await req.json() as { code: string };
    if (!code) return json({ error: '缺少 code 参数' }, 400);

    // 1. 换取 access_token
    const tokenData = await wxGetToken(code);
    if (!tokenData.access_token || !tokenData.openid) {
      console.error('WeChat token error:', tokenData);
      return json({ error: `微信授权失败: ${tokenData.errmsg ?? '未知错误'}` }, 400);
    }

    // 2. 获取用户信息
    const wxUser = await wxGetUserInfo(tokenData.access_token, tokenData.openid);
    if (wxUser.errcode) {
      console.error('WeChat userinfo error:', wxUser);
      return json({ error: `获取微信用户信息失败: ${wxUser.errmsg}` }, 400);
    }

    const openid   = wxUser.openid;
    const nickname = wxUser.nickname || '微信用户';
    const avatar   = wxUser.headimgurl || '';

    // 3. 管理员客户端
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 4. 查找已有账号（通过 user_profiles 表）
    const { data: profile } = await admin
      .from('user_profiles')
      .select('id')
      .eq('wechat_openid', openid)
      .maybeSingle();

    let userId: string;

    if (profile?.id) {
      // 已有账号，更新昵称/头像
      userId = profile.id;
      await admin
        .from('user_profiles')
        .update({ nickname, avatar_url: avatar, updated_at: new Date().toISOString() })
        .eq('id', userId);
    } else {
      // 新用户：创建 Supabase auth 账号
      const syntheticEmail = `wx_${openid}@wx.auth.internal`;
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email:            syntheticEmail,
        email_confirm:    true,   // 跳过邮件验证
        user_metadata:    { wechat_openid: openid, nickname, avatar_url: avatar, provider: 'wechat' },
      });

      if (createErr || !newUser.user) {
        console.error('Create user error:', createErr);
        return json({ error: '创建账号失败' }, 500);
      }
      userId = newUser.user.id;

      // 写入 user_profiles
      await admin.from('user_profiles').insert({
        id:            userId,
        wechat_openid: openid,
        nickname,
        avatar_url:    avatar,
      });
    }

    // 5. 生成 magic-link token（不会发送邮件，直接返回 hashed_token）
    const syntheticEmail = `wx_${openid}@wx.auth.internal`;
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type:  'magiclink',
      email: syntheticEmail,
      options: { redirectTo: '/' },
    });

    if (linkErr || !linkData) {
      console.error('GenerateLink error:', linkErr);
      return json({ error: '生成登录令牌失败' }, 500);
    }

    const token_hash = linkData.properties?.hashed_token;

    return json({
      ok: true,
      token_hash,
      email: syntheticEmail,
      nickname,
      avatar,
    });

  } catch (err) {
    console.error('Unhandled error:', err);
    return json({ error: String(err) }, 500);
  }
});
