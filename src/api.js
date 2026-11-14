import { getBase, getPass, getSess, setSess } from './store';
import { createFeed } from './sse';

// 现状（2026-11-12，mobile_server.py，后端已实测）：
//   POST /login  {p: 口令} -> { ok, ttl: 7200, session: "<43 位>" }
//        之后每个请求带 Authorization: Bearer <session>；cookie 那条路后端保留做兼容。
//   GET  /api/dsbot/advisors          -> { ok, advisors:[{id,name,role,status,activity?,tool?,since?}] }
//   GET  /api/dsbot/chat?bot=<id>     -> { ok, messages:[{who,text,at,seq?}] }（无 cursor）
//   POST /api/dsbot/send {bot,text}   -> 发一条后立刻把整段对话读回来（非流式）
//   GET  /api/dsbot/feed              -> SSE 长连接（解析/重连在 src/sse.js）

export class ApiError extends Error {
  constructor(message, step, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.step = step; // 'login' | 'auth' | 'list' | 'chat' | 'send' | 'feed'
    Object.assign(this, extra);
  }
}

export const SESSION_COOKIE = 'pocket_sess';
const COOKIE_HEADER = 'cookie';

// 超时时间（毫秒）
const DEFAULT_TIMEOUT = 20000; // 默认 20 秒
const UPLOAD_TIMEOUT = 60000; // 上传 60 秒

// 2026-11-12 后端已定：登录成功时响应体带 `session`（43 位不透明随机串）。
// 其余键名只为兼容旧服务端，正常不会命中。
const TOKEN_KEYS = [
  'session',
  'sess',
  'sessionToken',
  'session_token',
  'token',
  'authToken',
  'auth_token',
  'pocket_sess',
];

function join(base, path) {
  return String(base).replace(/\/+$/, '') + path;
}

function pickTokenFromBody(body) {
  if (!body || typeof body !== 'object') return { token: '', field: '' };
  const pools = [body, body.data, body.result, body.payload];
  for (const pool of pools) {
    if (!pool || typeof pool !== 'object') continue;
    for (const key of TOKEN_KEYS) {
      const v = pool[key];
      if (typeof v === 'string' && v.trim().length >= 8) {
        return { token: v.trim(), field: key };
      }
    }
  }
  return { token: '', field: '' };
}

function pickTokenFromHeaders(raw) {
  const re = new RegExp(SESSION_COOKIE + '=([^;\\s]+)', 'i');
  const hit = re.exec(raw || '');
  return hit ? hit[1] : '';
}

// 登录用 XHR：要读全部响应头（旧版 Set-Cookie 兜底）。主路是响应体里的 session。
function xhrLogin(url, payload) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url, true);
    x.setRequestHeader('content-type', 'application/json');
    x.timeout = 15000;
    x.onload = () => {
      let body = {};
      try {
        body = JSON.parse(x.responseText || '{}');
      } catch {
        body = {};
      }
      resolve({ status: x.status, body, headers: x.getAllResponseHeaders() || '' });
    };
    x.onerror = () => reject(new ApiError('网络不通，连不上那个地址', 'login'));
    x.ontimeout = () => reject(new ApiError('连接超时（15 秒）', 'login'));
    x.send(JSON.stringify(payload));
  });
}

// 认证优先级：响应体里的 `session` > 兼容回退（Set-Cookie）。
export async function login(base, pass) {
  let out;
  try {
    out = await xhrLogin(join(base, '/login'), { p: pass });
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError(e.message || '登录请求失败', 'login');
  }

  if (!out.body || !out.body.ok) {
    const msg = (out.body && out.body.error) || '登录被拒（HTTP ' + out.status + '）';
    throw new ApiError(msg, 'login', {
      locked: Boolean(out.body && out.body.locked),
      left: out.body && out.body.left,
    });
  }

  const fromBody = pickTokenFromBody(out.body);
  const fromCookie = pickTokenFromHeaders(out.headers);
  const token = fromBody.token || fromCookie;

  if (!token) {
    throw new ApiError('登录返回成功，但响应体和 Set-Cookie 里都找不到会话凭证', 'login');
  }

  await setSess(token);
  return {
    ttl: out.body.ttl || 0,
    source: fromBody.token ? 'body' : 'cookie',
    field: fromBody.token ? fromBody.field : SESSION_COOKIE,
  };
}

async function request(path, { method = 'GET', body, step = 'list', retry = true } = {}) {
  const base = await getBase();
  if (!base) throw new ApiError('还没填服务地址', step);

  const sess = await getSess();
  if (!sess) throw new ApiError('没有会话凭证，需要先登录', 'auth');

  // 主路：Authorization: Bearer（后端已实测：只带它、不带 cookie 也 200）。
  // 同时带上 cookie，为旧版服务端留兼容，两个都在不会互相干扰。
  const headers = {
    authorization: 'Bearer ' + sess,
    [COOKIE_HEADER]: SESSION_COOKIE + '=' + sess,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';

  // 判断超时时间：上传接口用 60 秒，其他用 20 秒
  const isUpload = path.includes('/upload');
  const timeoutMs = isUpload ? UPLOAD_TIMEOUT : DEFAULT_TIMEOUT;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(join(base, path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new ApiError('请求超时', step, { code: 'timeout', message: '等太久了，重试一下' });
    throw new ApiError('网络不通：' + (e.message || '请求失败'), step);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    if (retry) {
      // 会话过期（ttl 7200 秒）：用存下的口令自动重登一次，用户无感。
      const pass = await getPass();
      if (!pass) throw new ApiError('会话过期，而且没存口令，请回设置重新填', 'auth');
      await login(base, pass);
      return request(path, { method, body, step, retry: false });
    }
    throw new ApiError('会话无效（401）：口令或会话被拒', 'auth');
  }
  if (res.status === 404) {
    throw new ApiError('这个地址上没有该接口（404）：' + path, step);
  }

  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ApiError((data && data.error) || 'HTTP ' + res.status, step);
  }
  return data;
}

// ---- 通用透传（等代理层补上后自动启用）----
export async function botCall(endpoint, payload) {
  return request('/api/bot', { method: 'POST', body: { endpoint, payload }, step: 'list' });
}

// ---- 现有三条路由 ----
export async function advisors() {
  const d = await request('/api/dsbot/advisors', { step: 'list' });
  if (!d || !d.ok) throw new ApiError((d && d.error) || '读不到顾问列表', 'list');
  return d.advisors || [];
}

// 一次拿全：advisors() 只回 advisors 数组，把 groups 和 unreadNote 丢了，
// 而顾问列表页需要 groups（群组区）和 unreadNote（「电脑端看过的这里仍显示未读」那句）。
export async function advisorsFull() {
  const d = await request('/api/dsbot/advisors', { step: 'list' });
  if (!d || !d.ok) throw new ApiError((d && d.error) || '读不到顾问列表', 'list');
  return {
    advisors: d.advisors || [],
    groups: Array.isArray(d.groups) ? d.groups : [],
    unreadNote: typeof d.unreadNote === 'string' ? d.unreadNote : '',
  };
}

export async function chat(botId) {
  const d = await request('/api/dsbot/chat?bot=' + encodeURIComponent(botId), { step: 'chat' });
  if (!d || !d.ok) throw new ApiError((d && d.error) || '读不到对话', 'chat');
  return d.messages || [];
}

export async function send(botId, text) {
  const d = await request('/api/dsbot/send', {
    method: 'POST',
    body: { bot: botId, text },
    step: 'send',
  });
  if (!d || !d.ok) throw new ApiError((d && d.error) || '发送失败', 'send');
  return d.messages || [];
}

export async function models() {
  const d = await request('/api/dsbot/models', { step: 'models' });
  if (!d || !d.ok) throw new ApiError((d && d.error) || '读不到模型列表', 'models');
  return d.models || [];
}

export async function writeModel({ id, model }) {
  const d = await request('/api/dsbot/bot/' + encodeURIComponent(id) + '/model', {
    method: 'POST',
    body: { model },
    step: 'model',
  });
  if (!d || !d.ok) throw new ApiError((d && d.error) || '保存失败', 'model');
  return d;
}

// ---- 流式：SSE 长连接（解析与重连在 src/sse.js，那部分是纯 JS，可在 Node 里自测）----
// 断开后 2 秒退避重连（最长 10 秒）；401/403 不重连，直接报「请重新登录」。
export function openFeed({ onEvent, onError, onAuthFail }) {
  let handle = null;
  let cancelled = false;

  (async () => {
    const base = await getBase();
    const sess = await getSess();
    if (cancelled) return;
    if (!base || !sess) {
      onError && onError(new ApiError('没登录，开不了流', 'feed'));
      return;
    }
    handle = createFeed({
      url: join(base, '/api/dsbot/feed'),
      token: sess,
      xhrFactory: () => new XMLHttpRequest(),
      onEvent,
      onError: (e) => onError && onError(new ApiError(e.message || '流断了', 'feed')),
      onAuthFail: (status) => {
        const err = new ApiError(`会话过期（HTTP ${status}），请重新登录`, 'auth');
        onAuthFail ? onAuthFail(err) : onError && onError(err);
      },
    });
  })();

  return () => {
    cancelled = true;
    try {
      handle && handle.close();
    } catch {}
    handle = null;
  };
}

// ---- 个人主页（新接口 2026‑11‑13）----
export async function fetchMe() {
  const d = await request('/api/dsbot/me', { step: 'me' });
  if (!d || !d.ok) throw new ApiError((d && d.error) || '获取个人资料失败', 'me');
  return {
    nickname: d.nickname || '',
    avatarUrl: d.avatar_url || '',
    signature: d.signature || '',
  };
}

export async function updateMe(patch) {
  const d = await request('/api/dsbot/me', {
    method: 'POST',
    body: patch,
    step: 'update_me',
  });
  if (!d || !d.ok) throw new ApiError((d && d.error) || '更新个人资料失败', 'update_me');
  return d;
}

export async function uploadFile(fileUri, { type = 'image/jpeg', name = 'file.jpg', timeoutMs = UPLOAD_TIMEOUT } = {}) {
  const base = await getBase();
  if (!base) throw new ApiError('还没填服务地址', 'upload');
  const sess = await getSess();
  if (!sess) throw new ApiError('没有会话凭证，需要先登录', 'auth');

  const formData = new FormData();
  // 不手写 content-type：让 fetch 自己带 multipart boundary，否则后端解析必失败。
  formData.append('file', { uri: fileUri, type, name });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(join(base, '/api/dsbot/upload'), {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + sess,
        [COOKIE_HEADER]: SESSION_COOKIE + '=' + sess,
      },
      body: formData,
      credentials: 'include',
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new ApiError('上传超时', 'upload');
    throw new ApiError('上传失败：' + (e.message || '网络不通'), 'upload');
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (res.status === 401) throw new ApiError('会话无效（401）：需要重新登录', 'auth');
  if (!res.ok || !data || !data.ok) {
    throw new ApiError((data && data.error) || '上传失败', 'upload');
  }
  return data; // { ok: true, path: '...', url: '/api/dsbot/uploads/...' }
}

export async function uploadImage(fileUri) {
  return uploadFile(fileUri, { type: 'image/jpeg', name: 'avatar.jpg' });
}

export async function fetchMoments(limit = 20, offset = 0) {
  const d = await request('/api/dsbot/me/moments?limit=' + encodeURIComponent(limit) + '&offset=' + encodeURIComponent(offset), {
    step: 'moments',
  });
  if (!d || !d.ok) throw new ApiError((d && d.error) || '获取朋友圈失败', 'moments');
  return d.items || [];
}

export async function postMoment(text, media = []) {
  const d = await request('/api/dsbot/me/moment', {
    method: 'POST',
    body: { text, media },
    step: 'post_moment',
  });
  if (!d || !d.ok) throw new ApiError((d && d.error) || '发送朋友圈失败', 'post_moment');
  return d;
}
