import { getBase, getSess } from './store';

// 首页三块的数据层：各自独立，谁挂了都不影响另外两块。
// 不给假数兜底——接口失败就抛，由 UI 显示空态。
async function get(path) {
  const base = await getBase();
  if (!base) throw new Error('还没填服务地址');
  const sess = await getSess();
  if (!sess) throw new Error('没有会话凭证，需要先登录');
  let res;
  try {
    res = await fetch(String(base).replace(/\/+$/, '') + path, {
      method: 'GET',
      headers: { authorization: 'Bearer ' + sess },
      credentials: 'include',
    });
  } catch (e) {
    throw new Error('网络不通：' + (e.message || '请求失败'));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) {
    throw new Error((data && data.error) || 'HTTP ' + res.status);
  }
  return data;
}

// ① 今天动哪件（做只有 todo/doing/stage/done 四数 + waiting 五条；doing 恒 0，不做四栏）
export async function loadBoardSummary() {
  const d = await get('/api/board/summary');
  const counts = d.counts || {};
  return {
    todo: Number(counts.todo) || 0,
    doing: Number(counts.doing) || 0,
    stage: Number(counts.stage) || 0,
    done: Number(counts.done) || 0,
    waiting: Array.isArray(d.waiting) ? d.waiting.slice(0, 5) : [],
  };
}

// ② 今日热点（isToday=false 时不能假装是今天的，标题要用返回的 date）
export async function loadHotDaily() {
  const d = await get('/api/hot/daily');
  const items = Array.isArray(d.items) ? d.items : [];
  const picked = d.picked && typeof d.picked === 'object' ? d.picked : null;
  return {
    date: typeof d.date === 'string' ? d.date : '',
    isToday: Boolean(d.isToday),
    itemCount: items.length,
    picked: picked ? { title: picked.title || '', source: picked.source || '', url: picked.url || '' } : null,
  };
}

// ③ 接着写
export async function loadDraftResume() {
  const d = await get('/api/draft/resume');
  return {
    id: d.id || '',
    title: d.title || '',
    tail: d.tail || '',
    chars: Number(d.chars) || 0,
    source: d.source === 'opened' ? 'opened' : 'latest',
  };
}

// ④ 今日灵感
export async function loadIdeas() {
  const d = await get('/api/ideas');
  const items = Array.isArray(d.items) ? d.items : [];
  return {
    newest: items.length > 0 ? items[0] : null,
    total: items.length,
    items: items.slice(0, 5), // 首页显示最多 5 条
  };
}

// ⑤ 选题池
export async function loadTopics() {
  const d = await get('/api/topics');
  const items = Array.isArray(d.items) ? d.items : [];
  return {
    total: Number(d.total) || 0,
    items: items.slice(0, 5), // 首页显示最近 5 条
  };
}

// 上报「打开了哪一篇」：失败静默，不许因此弹错误
export async function reportDraftOpen(id) {
  try {
    if (!id) return;
    const base = await getBase();
    const sess = await getSess();
    if (!base || !sess) return;
    await fetch(String(base).replace(/\/+$/, '') + '/api/draft/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + sess },
      credentials: 'include',
      body: JSON.stringify({ id }),
    });
  } catch (e) {
    /* 故意吞掉 */
  }
}

// 字数：≥1 万显示「x.x 万字」，否则「x 字」
export function charsLabel(n) {
  const v = Number(n) || 0;
  if (v >= 10000) return (v / 10000).toFixed(1) + ' 万字';
  return v + ' 字';
}
