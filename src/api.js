import { getBase, getPass, getSess, setSess } from './store';

// 现状（2026-11-12 实测，mobile_server.py）：
//   POST /login        {p: 口令} -> Set-Cookie: pocket_sess（2 小时，HttpOnly）
//   GET  /api/dsbot/advisors          -> { ok, advisors:[{id,name,role}] }
//   GET  /api/dsbot/chat?bot=<id>     -> { ok, messages:[{who,text,at}] }（无 cursor）
//   POST /api/dsbot/send {bot,text}   -> 发一条后立刻把整段对话读回来（非流式）
// 通用透传 POST /api/bot 与 SSE GET /api/bot/feed 在代理层还不存在（见 CHANGELOG 缺口）。

export class ApiError extends Error {
  constructor(message, step, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.step = step; // 'login' | 'auth' | 'list' | 'chat' | 'send' | 'feed'
    Object.assign(this, extra);
  }
}

function join(base, path) {
  return String(base).replace(/\/+$/, '') + path;
}

// 登录走 XHR 而不是 fetch：RN 的 fetch 在 iOS 上拿不到 Set-Cookie，
// XHR 的 getAllResponseHeaders() 能拿到。这是第一版「填了口令却一直未登录」的根因。
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
      const raw = x.getAllResponseHeaders() || '';
      const hit = /pocket_sess=([^;\s]+)/i.exec(raw);
      resolve({ status: x.status, body, cookie: hit ? hit[1] : '' });
    };
    x.onerror = () => reject(new ApiError('网络不通，连不上那个地址', 'login'));
    x.ontimeout = () => reject(new ApiError('连接超时（15 秒）', 'login'));
    x.send(JSON.stringify(payload));
  });
}

export async function login(base, pass) {
  let out;
  try {
    out = await xhrLogin(join(base, '/login'), { p: pass });
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError(e.message || '登录请求失败', 'login');
  }
  if (!out.body || !out.body.ok) {
    const msg = (out.body && out.body.error) || `登录被拒（HTTP ${out.status}）`;
    throw new ApiError(msg, 'login', {
      locked: Boolean(out.body && out.body.locked),
      left: out.body && out.body.left,
    });
  }
  if (!out.cookie) {
    throw new ApiError('登录成功但没拿到会话凭证（Set-Cookie 为空）', 'login');
  }
  await setSess(out.cookie);
  return { ttl: out.body.ttl || 0 };
}

async function authHeaders() {
  const sess = await getSess();
  return sess ? { cookie: `pocket_sess=${sess}` } : {};
}

async function request(path, { method = 'GET', body, step = 'list', retry = true } = {}) {
  const base = await getBase();
  if (!base) throw new ApiError('还没填服务地址', step);

  const sess = await getSess();
  if (!sess) throw new ApiError('没有会话凭证，需要先登录', 'auth');

  const headers = { cookie: `pocket_sess=${sess}` };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let res;
  try {
    res = await fetch(join(base, path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
    });
  } catch (e) {
    throw new ApiError('网络不通：' + (e.message || '请求失败'), step);
  }

  if (res.status === 401) {
    if (retry) {
      // 会话过期（2 小时）：用存下的口令自动换新的，用户无感。
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
    throw new ApiError((data && data.error) || `HTTP ${res.status}`, step);
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

// ---- 流式：优先 SSE；代理层没这条路由就降级轮询 ----
export function openFeed({ onEvent, onError }) {
  let xhr = null;
  let closed = false;

  (async () => {
    const base = await getBase();
    const sess = await getSess();
    if (!base || !sess) {
      onError && onError(new ApiError('没登录，开不了流', 'feed'));
      return;
    }
    xhr = new XMLHttpRequest();
    let seen = 0;
    xhr.open('GET', join(base, '/api/bot/feed'));
    xhr.setRequestHeader('cookie', `pocket_sess=${sess}`);
    xhr.setRequestHeader('accept', 'text/event-stream');
    xhr.timeout = 0;

    xhr.onprogress = () => {
      const buf = xhr.responseText || '';
      const fresh = buf.slice(seen);
      seen = buf.length;
      fresh.split('\n\n').forEach((chunk) => {
        const ev = /^event:\s*(.+)$/m.exec(chunk);
        const data = /^data:\s*(.+)$/m.exec(chunk);
        if (!ev || !data) return;
        let parsed = null;
        try {
          parsed = JSON.parse(data[1]);
        } catch {
          return;
        }
        onEvent && onEvent(ev[1].trim(), parsed);
      });
    };
    xhr.onerror = () => !closed && onError && onError(new ApiError('流断了', 'feed'));
    xhr.onloadend = () => !closed && onError && onError(new ApiError('流结束', 'feed'));
    xhr.send();
  })();

  return () => {
    closed = true;
    try {
      xhr && xhr.abort();
    } catch {}
  };
}
