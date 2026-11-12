import { getBase, getPass, getSess, setSess } from './store';

// 现状（2026-11-12 实测）：口袋服务上可用的路由只有
//   POST /login        {p: 口令} -> Set-Cookie: pocket_sess（2 小时，HttpOnly）
//   GET  /api/dsbot/advisors          -> { ok, advisors:[{id,name,role}] }
//   GET  /api/dsbot/chat?bot=<id>     -> { ok, messages:[{who,text,at}] }（无 cursor）
//   POST /api/dsbot/send {bot,text}   -> 发一条后立刻把整段对话读回来（非流式）
// 通用透传 POST /api/bot 与 SSE GET /api/bot/feed 在代理层还不存在（见 CHANGELOG 缺口）。
// 所以这里两条腿走路：先试通用路由，404/401 时退回上面三条。

function join(base, path) {
  return String(base).replace(/\/+$/, '') + path;
}

async function readSessFrom(res) {
  // RN 上 set-cookie 有时能读到、有时交给系统 cookie jar 代管；两种都容忍。
  const raw = res.headers.get('set-cookie') || '';
  const m = /pocket_sess=([^;]+)/.exec(raw);
  return m ? m[1] : '';
}

export async function login(base, pass) {
  const res = await fetch(join(base, '/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ p: pass }),
    credentials: 'include',
  });
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  if (!body.ok) {
    const err = new Error(body.error || '登录失败');
    err.locked = Boolean(body.locked);
    err.left = body.left;
    throw err;
  }
  const sess = await readSessFrom(res);
  if (sess) await setSess(sess);
  return { ttl: body.ttl || 0, sessCaptured: Boolean(sess) };
}

async function authHeaders() {
  const sess = await getSess();
  return sess ? { cookie: `pocket_sess=${sess}` } : {};
}

async function request(path, { method = 'GET', body, retry = true } = {}) {
  const base = await getBase();
  if (!base) throw new Error('还没填服务地址');

  const headers = { ...(await authHeaders()) };
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(join(base, path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
  });

  if (res.status === 401 && retry) {
    // 会话过期（2 小时）：用存下的口令自动换新的，用户无感。
    const pass = await getPass();
    if (!pass) throw new Error('会话过期，而且没存口令，请重新设置');
    await login(base, pass);
    return request(path, { method, body, retry: false });
  }
  if (res.status === 404) {
    const e = new Error('NOT_FOUND');
    e.code = 'NOT_FOUND';
    throw e;
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = new Error((data && data.error) || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

// ---- 通用透传（等代理层补上后自动启用）----
export async function botCall(endpoint, payload) {
  return request('/api/bot', { method: 'POST', body: { endpoint, payload } });
}

// ---- 现有三条路由：能跑，但字段有损 ----
export async function advisors() {
  const d = await request('/api/dsbot/advisors');
  if (!d || !d.ok) throw new Error((d && d.error) || '读不到顾问列表');
  return d.advisors || [];
}

export async function chat(botId) {
  const d = await request('/api/dsbot/chat?bot=' + encodeURIComponent(botId));
  if (!d || !d.ok) throw new Error((d && d.error) || '读不到对话');
  return d.messages || [];
}

export async function send(botId, text) {
  const d = await request('/api/dsbot/send', { method: 'POST', body: { bot: botId, text } });
  if (!d || !d.ok) throw new Error((d && d.error) || '发送失败');
  return d.messages || [];
}

// ---- 流式：优先 SSE，代理层没这条路由就报 NOT_FOUND，由上层降级为轮询 ----
export function openFeed({ onEvent, onError }) {
  let xhr = null;
  let closed = false;

  (async () => {
    const base = await getBase();
    if (!base) {
      onError && onError(new Error('还没填服务地址'));
      return;
    }
    const headers = await authHeaders();
    xhr = new XMLHttpRequest();
    let seen = 0;
    xhr.open('GET', join(base, '/api/bot/feed'));
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.setRequestHeader('accept', 'text/event-stream');

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
    xhr.onerror = () => !closed && onError && onError(new Error('FEED_UNAVAILABLE'));
    xhr.onloadend = () => !closed && onError && onError(new Error('FEED_UNAVAILABLE'));
    xhr.send();
  })();

  return () => {
    closed = true;
    try {
      xhr && xhr.abort();
    } catch {}
  };
}
