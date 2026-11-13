import { getBase, getSess } from './store';

// 工作台功能页接口层（对照 8788 的真实契约写的，逐条都在 mobile_server.py 里核过行号）。
// 规矩：契约不清楚的**不写**——宁可留着死按钮，也不写一个会骗人的按钮。
// 目前故意缺的四个（后端正在把「不存在的 id 也返回 ok:true」改成报错）：
//   POST /api/topic_status、POST /api/topic_del、POST /api/view_del、POST /api/vote

const DEFAULT_TIMEOUT = 30000;
// 评审两条是慢接口：atom/review 实测 9.4 秒、view_review 7.4 秒，服务端超时 240 秒。
// 客户端给 90 秒，别用默认值（否则用户点完等到一半就超时）。
const REVIEW_TIMEOUT = 90000;

async function request(path, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  const base = await getBase();
  if (!base) throw new Error('还没填服务地址');
  const sess = await getSess();
  if (!sess) throw new Error('没有会话凭证，需要先登录');

  const headers = { authorization: 'Bearer ' + sess };
  if (body !== undefined) headers['content-type'] = 'application/json';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(String(base).replace(/\/+$/, '') + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('等太久了，重试一下');
    throw new Error('网络不通：' + (e.message || '请求失败'));
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
  if (!data) throw new Error('返回的内容看不懂');
  if (data.ok === false) throw new Error(data.error || '这个操作没成功');
  return data;
}

/* ───────────────────────── 选题池 ─────────────────────────
 * GET /api/topics
 *   参数: 无。status / board / minScore / limit 全被服务端忽略（实测 total 恒 112、items 恒 30）
 *   成功: {ok, total, items:[{id,title,status,note,score,level,dims,board,hook,why,draftLen,hasDraft}]}
 *   失败: {ok:false, error:<sqlite 原文>}
 *   注意: 筛选只能客户端本地做。board 六个中文值见 TOPIC_BOARDS。
 */
export const TOPIC_BOARDS = ['AI 与工具', '内容创作', '商业与变现', '心理与人性', '语言与思维', '身心与生活'];

export async function getTopics() {
  const d = await request('/api/topics');
  return { total: Number(d.total) || 0, items: Array.isArray(d.items) ? d.items : [] };
}

/* ─────────────────────── 观点库（表态列表） ───────────────────────
 * GET /api/list?offset=&limit=
 *   参数: offset 不传 = 随机取一段（老行为）；传了 = 真分页；limit 默认 20
 *   成功: {ok, left, done, items:[{id,author,claim}]}
 *         传了 offset 才多 {offset, nextOffset, hasMore}
 *   失败: handler 没有 try/except，出错直接 500（不是 ok:false）
 */
export async function getList({ offset, limit = 20 } = {}) {
  const qs = [];
  if (offset !== undefined && offset !== null) qs.push('offset=' + encodeURIComponent(String(offset)));
  if (limit) qs.push('limit=' + encodeURIComponent(String(limit)));
  const d = await request('/api/list' + (qs.length ? '?' + qs.join('&') : ''));
  return {
    left: Number(d.left) || 0,
    done: Number(d.done) || 0,
    items: Array.isArray(d.items) ? d.items : [],
    offset: typeof d.offset === 'number' ? d.offset : null,
    nextOffset: typeof d.nextOffset === 'number' ? d.nextOffset : null,
    hasMore: Boolean(d.hasMore),
  };
}

/* ─────────────────────── AI 评审（两条，都慢） ───────────────────────
 * POST /api/atom/review   body {atomId}
 *   成功: {ok, atomId, author, review:{score,verdict,pros[],gaps[],questions[],one_line}}   实测 9.4s
 *   失败: {ok:false,error}
 * POST /api/view_review   body {id}
 *   成功: {ok, review:{同上}}   实测 7.4s
 *   失败: {ok:false,error}
 * 注意: 详情页「AI 怎么看这条」和「让 AI 讲透这条」是两个接口，别混。
 */
export async function postAtomReview(atomId) {
  const d = await request('/api/atom/review', { method: 'POST', body: { atomId }, timeoutMs: REVIEW_TIMEOUT });
  return { atomId: d.atomId || atomId, author: d.author || '', review: d.review || null };
}

export async function postViewReview(id) {
  const d = await request('/api/view_review', { method: 'POST', body: { id }, timeoutMs: REVIEW_TIMEOUT });
  return { review: d.review || null };
}

/* ─────────────────── 「让 AI 讲透」：返回纯文本，不是 JSON ───────────────────
 * POST /api/dsh-media/explain   body {text}
 *   成功: content-type text/plain，一次性非流式，实测 5.4 秒 → 直接拿字符串
 *   失败: 可能不是 JSON，按 HTTP 状态给一句人话
 * ★ 这条必须用 resp.text()，不能 json()
 */
export async function postExplain(text) {
  const base = await getBase();
  const sess = await getSess();
  if (!base || !sess) throw new Error('还没有会话凭证');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REVIEW_TIMEOUT);
  let res;
  try {
    res = await fetch(String(base).replace(/\/+$/, '') + '/api/dsh-media/explain', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + sess },
      body: JSON.stringify({ text }),
      credentials: 'include',
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('等太久了，重试一下');
    throw new Error('网络不通：' + (e.message || '请求失败'));
  } finally {
    clearTimeout(timer);
  }
  const raw = await res.text().catch(() => '');
  if (!res.ok) throw new Error(raw && raw.length < 200 ? raw : 'HTTP ' + res.status);
  return String(raw || '').trim();
}

/* ───────────────────────── 我的观点 ─────────────────────────
 * GET /api/myview?id=
 *   成功: {ok, id, title, content, at}
 *   失败: {ok:false,error}
 */
export async function getMyView(id) {
  const d = await request('/api/myview?id=' + encodeURIComponent(String(id)));
  return { id: d.id || id, title: d.title || '', content: d.content || '', at: d.at || '' };
}

/* ───────────────────────── 语料库 ─────────────────────────
 * GET /api/corpus?q=&limit=
 *   参数: q 可选模糊搜；limit 默认 40
 *   成功: {ok, total, items:[{id,title,kind,chars,at}], q}
 *   失败: {ok:false,error}
 */
export async function getCorpus({ q, limit = 40 } = {}) {
  const qs = ['limit=' + encodeURIComponent(String(limit))];
  if (q) qs.push('q=' + encodeURIComponent(q));
  const d = await request('/api/corpus?' + qs.join('&'));
  return {
    total: Number(d.total) || 0,
    q: d.q || '',
    items: Array.isArray(d.items) ? d.items : [],
  };
}

/* ───────────────────────── 书库 ─────────────────────────
 * GET /api/book_cards?verdict=&q=
 *   verdict 是中文：精读 / 翻翻 / 跳过；limit 默认 60
 *   成功: {ok, total, stat:{精读,翻翻,跳过}, items[...]}
 *   失败: {ok:false,error}
 */
export const BOOK_VERDICTS = ['精读', '翻翻', '跳过'];

export async function getBookCards({ verdict, q, limit = 60 } = {}) {
  const qs = ['limit=' + encodeURIComponent(String(limit))];
  if (verdict) qs.push('verdict=' + encodeURIComponent(verdict));
  if (q) qs.push('q=' + encodeURIComponent(q));
  const d = await request('/api/book_cards?' + qs.join('&'));
  return {
    total: Number(d.total) || 0,
    stat: d.stat && typeof d.stat === 'object' ? d.stat : {},
    items: Array.isArray(d.items) ? d.items : [],
  };
}

/* GET /api/book/read?id=&offset=&limit=
 *   限定 limit 默认 20
 *   成功: {ok, bookId, title, author, pages, total, offset, returned, hasMore, nextOffset, savedIdx,
 *          blocks:[{id,from,to,heading,text}]}
 *   失败: {ok:false,error}
 */
export async function getBookRead({ id, offset = 0, limit = 20 } = {}) {
  const qs = [
    'id=' + encodeURIComponent(String(id || '')),
    'offset=' + encodeURIComponent(String(offset)),
    'limit=' + encodeURIComponent(String(limit)),
  ];
  const d = await request('/api/book/read?' + qs.join('&'));
  return {
    bookId: d.bookId || id,
    title: d.title || '',
    author: d.author || '',
    pages: Number(d.pages) || 0,
    total: Number(d.total) || 0,
    offset: Number(d.offset) || 0,
    returned: Number(d.returned) || 0,
    hasMore: Boolean(d.hasMore),
    nextOffset: typeof d.nextOffset === 'number' ? d.nextOffset : null,
    savedIdx: Number(d.savedIdx) || 0,
    blocks: Array.isArray(d.blocks) ? d.blocks : [],
  };
}

/* POST /api/book/progress   body {id, chunkIdx, total}
 *   成功: {ok:true}
 *   失败: {ok:false,error}
 */
export async function postBookProgress({ id, chunkIdx, total }) {
  await request('/api/book/progress', { method: 'POST', body: { id, chunkIdx, total } });
  return true;
}

/* ───────────────────── 写稿（轮询，没有百分比） ─────────────────────
 * POST /api/draft {id, rewrite?} → 1ms 返回 {ok, task:"t…"}（task 形如 ^t\d{11}$）
 * GET  /api/draft_status?task=t… （★ 下划线；/api/draft/status 是 404）
 *   running → {ok:true, state:"running"}
 *   done    → {ok:true, state:"done", text:"完整稿子"}   ← 全文，不是增量
 *   error   → {ok:false, state:"error", error:"…"}
 *   过期    → {ok:false, error:"任务不存在或已过期"}      ← 没有 state 字段
 * ★ 服务端没有进度百分比，UI 只能「转圈 + 已等 N 秒」，一轮实测 8–10 秒。
 */
const TASK_RE = /^t\d{11}$/;

export async function startDraft(id, { rewrite = false } = {}) {
  const d = await request('/api/draft', { method: 'POST', body: { id, rewrite: !!rewrite } });
  if (!d.task || !TASK_RE.test(String(d.task))) throw new Error('写稿任务号不对：' + String(d.task));
  return String(d.task);
}

export async function waitDraft(task, { intervalMs = 2000, timeoutMs = 90000, onTick } = {}) {
  const t0 = Date.now();
  for (;;) {
    const d = await request('/api/draft_status?task=' + encodeURIComponent(task)).catch((e) => {
      // 过期/不存在时后端是 ok:false + error，没有 state —— 原样抛给 UI
      throw e;
    });
    if (d.state === 'done') return { text: typeof d.text === 'string' ? d.text : '' };
    if (Date.now() - t0 > timeoutMs) throw new Error('写稿超时，可以重试');
    if (onTick) onTick(Date.now() - t0);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/* ───────────────────── 撤销上一次表态 ─────────────────────
 * GET /api/undo
 *   成功: {ok, item:{id,author,claim}|null, left, done}
 *   失败: {ok:false, error:"还没有表态过，撤不回"}
 * ★ 撤的是「最近一次表态」，不是屏幕上那一条 → 调用方必须重拉 /api/list。
 * ★ created_at 是秒级，同一秒连点两次会删不准 → 表态要加 1 秒防抖。
 */
export async function undoLast() {
  const d = await request('/api/undo');
  return { item: d.item || null, left: Number(d.left) || 0, done: Number(d.done) || 0 };
}

/* ───────────────────── 语料库列表（走插件代理，带正文预览） ─────────────────────
 * GET /api/dsh-media/views/list?limit=&q=
 *   为什么不用 /api/corpus：那条返回 {id,title,kind,chars,at}，**没有 content**，
 *   而语料库卡片要显示正文前两行；views/list 返回 views:[{id,kind,title,content,chars,created_at}]。
 *   成功: {ok, total, views[]}
 *   失败: {ok:false,error} 或非 2xx
 */
export async function getCorpusViews({ q, limit = 120 } = {}) {
  const qs = ['limit=' + encodeURIComponent(String(limit))];
  if (q) qs.push('q=' + encodeURIComponent(q));
  const d = await request('/api/dsh-media/views/list?' + qs.join('&'));
  return {
    total: Number(d.total) || 0,
    rows: (Array.isArray(d.views) ? d.views : []).map((v) => ({
      id: v.id,
      kind: v.kind || '',
      title: v.title || '',
      content: v.content || '',
      chars: Number(v.chars) || 0,
      created_at: v.created_at || v.at || '',
    })),
  };
}

/* ───────── 选题池的写操作（后端 2026-11-13 改成 rowcount 判定，不再假成功） ─────────
 * POST /api/topic_status {id, status}  → {ok:true}；缺参 {ok:false, error:"缺参数"}；status 不校验枚举
 * POST /api/topic_del    {id}          → 成功 {ok:true, deleted:1}；不存在 {ok:false, error:"找不到这个选题"}
 * ★ 用 rowcount 判定，不存在就报错，不是以前那种假 ok:true。
 */
export async function setTopicStatus(id, status) {
  await request('/api/topic_status', { method: 'POST', body: { id, status } });
  return true;
}

export async function delTopic(id) {
  try {
    const d = await request('/api/topic_del', { method: 'POST', body: { id } });
    return { ok: true, deleted: Number(d.deleted) || 0, gone: false };
  } catch (e) {
    // 「找不到」说明别处已删 → 调用方应当本地也移除，不弹错误
    if (String(e.message || '').indexOf('找不到') >= 0) return { ok: false, deleted: 0, gone: true };
    throw e;
  }
}

/* ───────── 观点库/我的观点的写操作 ─────────
 * POST /api/vote {atomId, verdict, why} → 成功 {ok:true, view_id}；不存在 {ok:false, error:"这条观点不存在"}
 *   verdict 只认 agree / disagree；why 必填
 *   ★ 没有防重复：投完必须重拉 /api/list（列表用 not in my_views 过滤，投过的自然消失）
 * POST /api/view_del {id} → 成功 {ok:true, deleted:1}；不存在 {ok:false, error:"找不到这条观点"}
 */
export async function postVote({ atomId, verdict, why }) {
  try {
    const d = await request('/api/vote', { method: 'POST', body: { atomId, verdict, why } });
    return { ok: true, viewId: d.view_id || '', gone: false };
  } catch (e) {
    if (String(e.message || '').indexOf('找不到') >= 0 || String(e.message || '').indexOf('不存在') >= 0) {
      return { ok: false, viewId: '', gone: true };
    }
    throw e;
  }
}

export async function delView(id) {
  try {
    const d = await request('/api/view_del', { method: 'POST', body: { id } });
    return { ok: true, deleted: Number(d.deleted) || 0, gone: false };
  } catch (e) {
    if (String(e.message || '').indexOf('找不到') >= 0) return { ok: false, deleted: 0, gone: true };
    throw e;
  }
}

/* ───────────────────── 我的观点：列表 ─────────────────────
 * GET /api/myviews  （mobile_server.py:509 api_myviews，路由 3347）
 *   参数: limit 默认 30（路由层不读 query，固定 30）
 *   成功: {ok, total, items:[{id, title, kind, at, review:{...}|{}}]}
 *        review 是 ai_review 字段解析出来的对象，没评过就是 {}
 *   失败: {ok:false, error:<sqlite 原文>}
 */
export async function getMyViews() {
  const d = await request('/api/myviews');
  const items = (Array.isArray(d.items) ? d.items : []).map((v) => ({
    id: v.id,
    title: v.title || '',
    kind: v.kind || '',
    at: v.at || '',
    review: v.review && typeof v.review === 'object' ? v.review : {},
  }));
  return { total: Number(d.total) || 0, items };
}
