import { getBase, getPass, getSess } from './store';

// Bot 写接口层（11 项）。单独成文件，避免动 api.js 的现有调用面。
// 约定：全部带 Authorization: Bearer；失败体是 {ok:false,error:"中文原因"}，原样抛给 UI 显示。

async function call(path, { method = 'POST', body, signal } = {}) {
  const base = await getBase();
  if (!base) throw new Error('还没填服务地址');
  const sess = await getSess();
  if (!sess) throw new Error('没有会话凭证，需要先登录');

  const headers = { authorization: 'Bearer ' + sess };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let res;
  try {
    res = await fetch(String(base).replace(/\/+$/, '') + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new Error('网络不通：' + (e.message || '请求失败'));
  }

  // 401：用存量口令自动重登一次（与 api.js 同策略）
  if (res.status === 401) {
    const pass = await getPass();
    if (!pass) throw new Error('会话过期，请回设置重新登录');
    const r = await fetch(String(base).replace(/\/+$/, '') + '/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ p: pass }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j || !j.ok || typeof j.session !== 'string') throw new Error('自动重登失败，请回设置重新登录');
    return call(path, { method, body, signal });
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || (data && data.ok === false)) {
    throw new Error((data && data.error) || 'HTTP ' + res.status);
  }
  return data;
}

const bot = (id, action) => '/api/dsbot/bot/' + encodeURIComponent(id) + (action ? '/' + action : '');

export const botApi = {
  flags: (id, pinned) => call(bot(id, 'flags'), { body: { pinned } }),
  hidden: (id, hidden) => call(bot(id, 'hidden'), { body: { hidden } }),
  markUnread: (id) => call(bot(id, 'mark-unread'), { body: {} }),
  rename: (id, name) => call(bot(id, 'name'), { body: { name } }),
  role: (id, role) => call(bot(id, 'role'), { body: { role } }),
  color: (id, color) => call(bot(id, 'color'), { body: { color } }),
  shape: (id, shape) => call(bot(id, 'shape'), { body: { shape } }),
  model: (id, model) => call(bot(id, 'model'), { body: { model } }),
  effort: (id, effort) => call(bot(id, 'effort'), { body: { effort } }),
  newPart: (id) => call(bot(id, 'new-part'), { body: {} }),
  remove: (id) => call(bot(id, ''), { method: 'DELETE' }),
  read: (id) => call('/api/dsbot/read', { body: { id } }),
  readAll: () => call('/api/dsbot/read', { body: { all: true } }),
};

// 改形状 / 改颜色的可选值（与后端白名单逐字一致，大小写敏感）
export const COLORS = [
  'aurora', 'black', 'blue', 'brown', 'charcoal', 'cobalt', 'cyan', 'deepseek', 'graphite',
  'gray', 'green', 'magenta', 'orange', 'red', 'rose', 'sky', 'tangerine', 'violet', 'yellow',
];

export const SHAPE_NAMES = [
  'whale', 'star', 'moon', 'wave', 'squircle', 'zed', 'hex', 'gumdrop', 'peanut', 'saucer',
  'bunny', 'kitty', 'beacon', 'plus', 'magnet', 'acorn', 'pebbles', 'cushion', 'ring', 'gem',
];

// 群：读消息 / 发消息。后端已把 /api/dsbot/send 扩到认群 id，返回体与 GET 同一个结构。
// 一页 20 条、seq 升序；cursor 是 JSON 字符串 {"beforeSeq":N}，不传就是第一页。
export const groupApi = {
  chat: (groupId, cursor) =>
    call(
      '/api/dsbot/group?group=' + encodeURIComponent(groupId) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      { method: 'GET' },
    ),
  send: (groupId, text, media) => call('/api/dsbot/send', { body: { bot: groupId, text, ...(media && media.length ? { media } : {}) } }),
};

// 语音整理（口头文字 → 书面语）。<4 字后端原样返回且 changed=false；>4000 字直接报错。
export const speechApi = {
  tidy: (text) => call('/api/speech/tidy', { body: { text } }),
};

// 表达训练（说完再标）：analyze 本地 12ms 出四数 + highlight；realtime/polish/report 走模型。
export const expressionApi = {
  analyze: (text) => call('/api/expression/analyze', { body: { text } }),
  realtime: (text) => call('/api/expression/realtime', { body: { text } }),
  polish: (text) => call('/api/expression/polish', { body: { text } }),
  report: (fullText, stats, signal) => call('/api/expression/report', { body: { fullText, stats }, signal }),
};
