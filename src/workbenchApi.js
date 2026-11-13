import { getBase, getSess } from './store';

// 工作台功能页的接口层。只收「契约已经完全清楚」的那几条；
// 契约没到的一律不写（宁可留着死按钮，也不写一个会骗人的按钮）。

async function call(path, { method = 'GET', body } = {}) {
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
    });
  } catch (e) {
    throw new Error('网络不通：' + (e.message || '请求失败'));
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error((data && data.error) || 'HTTP ' + res.status);
  // 后端约定：业务失败是 {ok:false, error:"中文原因"}，原样抛给 UI 显示
  if (data.ok === false) throw new Error(data.error || '这个操作没成功');
  return data;
}

const TASK_RE = /^t\d{11}$/;

/**
 * 写稿：POST /api/draft {id, rewrite?} → 1ms 返回 {ok:true, task:"t94531563579"}
 * 服务端没有并发限制，但我们一次只发一个任务（排队更安全，由调用方保证）。
 */
export async function startDraft(id, { rewrite = false } = {}) {
  const d = await call('/api/draft', { method: 'POST', body: { id, rewrite: !!rewrite } });
  if (!d.task || !TASK_RE.test(String(d.task))) throw new Error('写稿任务号不对：' + String(d.task));
  return String(d.task);
}

/**
 * 轮询写稿状态：GET /api/draft_status?task=t…
 *   运行中  {ok:true,  state:"running"}
 *   完成    {ok:true,  state:"done", text:"完整稿子"}   ← text 是全文不是增量
 *   出错    {ok:false, state:"error", error:"…"}
 *   过期    {ok:false, error:"任务不存在或已过期"}       ← 注意这条没有 state 字段
 * 实测一轮约 10 秒，所以 2 秒一次、最多等 90 秒。
 */
export async function waitDraft(task, { intervalMs = 2000, timeoutMs = 90000, onTick } = {}) {
  const startedAt = Date.now();
  for (;;) {
    const raw = await fetchRawDraftStatus(task);
    if (raw.state === 'done') return { text: typeof raw.text === 'string' ? raw.text : '' };
    if (raw.state === 'error') throw new Error(raw.error || '写稿失败');
    if (!raw.state && raw.error) throw new Error(raw.error); // 过期/不存在，没有 state 字段
    if (Date.now() - startedAt > timeoutMs) throw new Error('写稿超时，可以重试');
    if (onTick) onTick(Date.now() - startedAt);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// 状态查询要能拿到 {ok:false, state:"error"} 这种「业务失败也带字段」的体，所以不走 call()
async function fetchRawDraftStatus(task) {
  const base = await getBase();
  const sess = await getSess();
  if (!base || !sess) throw new Error('还没有会话凭证');
  let res;
  try {
    res = await fetch(
      String(base).replace(/\/+$/, '') + '/api/draft_status?task=' + encodeURIComponent(task),
      { method: 'GET', headers: { authorization: 'Bearer ' + sess }, credentials: 'include' },
    );
  } catch (e) {
    throw new Error('网络不通：' + (e.message || '请求失败'));
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error('HTTP ' + res.status);
  return data;
}

/**
 * 撤销上一次表态：GET /api/undo
 *   成功 {ok:true, item:{id, author, claim}}   —— 删 my_views 里 kind='clash' 最新一条，left+1 / done-1
 *   没有 {ok:false, error:"还没有表态过，撤不回"}
 * ⚠ 撤的是「最近一次表态」，不是屏幕上这一条 → 调用方必须重新拉列表，不能只删本地项。
 * ⚠ created_at 是秒级，同一秒连点两次会删不准 → 调用方要对表态加 1 秒防抖。
 */
export async function undoLast() {
  const d = await call('/api/undo');
  if (!d.item || typeof d.item !== 'object') throw new Error('撤回没有返回被撤的那条');
  return d.item;
}
