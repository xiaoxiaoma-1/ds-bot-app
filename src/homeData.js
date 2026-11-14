import { getBase, getPass, getSess } from './store';
import { login } from './api';

// 首页三块的数据层：各自独立，谁挂了都不影响另外两块。
// 不给假数兜底——接口失败就抛，由 UI 显示空态。
//
// 401 自动重登（2026-11-14）：8788 的会话一失效就回 401 {ok:false,error:"未登录"}。
// api.js 那条链路有自动重登，这一条当初没有，所以「今日灵感」在会话失效后一直显示未登录，
// 而顾问 / 聊天照常——同一次会话里两套行为，用户只能怀疑自己没登录。
let reloginLock = null;
async function reloginOn401(base) {
  const pass = await getPass();
  if (!pass) return false;
  try {
    if (!reloginLock) {
      reloginLock = login(base, pass).finally(() => {
        reloginLock = null;
      });
    }
    await reloginLock;
    return true;
  } catch (e) {
    return false;
  }
}

async function get(path, { retry = true } = {}) {
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
  if (res.status === 401) {
    if (retry && (await reloginOn401(base))) return get(path, { retry: false });
    throw new Error('会话失效了（401）：回设置重新登录一下');
  }
  if (!res.ok || !data || data.ok === false) {
    throw new Error((data && data.error) || 'HTTP ' + res.status);
  }
  return data;
}

// ① 今天动哪件（做只有 todo/doing/stage/done 四数 + waiting 五条；doing 恒 0，不做四栏）
export async function loadBoardSummary() {
  const d = await get('/api/board/summary');
  const counts = d.counts || {};
  const cards = Array.isArray(d.cards) ? d.cards.map((x) => ({
    id: String((x && x.id) || ''),
    title: String((x && x.title) || ''),
    status: String((x && x.status) || ''),
    nextStep: String((x && x.nextStep) || ''),
    workspace: String((x && x.workspace) || ''),
  })) : [];
  
  return {
    todo: Number(counts.todo) || 0,
    doing: Number(counts.doing) || 0,
    stage: Number(counts.stage) || 0,
    done: Number(counts.done) || 0,
    waiting: Array.isArray(d.waiting) ? d.waiting.slice(0, 5) : [],
    cards,
  };
}

// ② 今日热点（isToday=false 时不能假装是今天的，标题要用返回的 date）
export async function loadHotDaily() {
  const d = await get('/api/hot/daily');
  const rawItems = Array.isArray(d.items) ? d.items : [];
  const items = rawItems
    .map((x) => ({
      title: String((x && x.title) || ''),
      source: String((x && x.source) || ''),
      url: String((x && x.url) || ''),
    }))
    .filter((x) => x.title);
  const rawPicked = d.picked && typeof d.picked === 'object' ? d.picked : null;
  const picked = rawPicked
    ? {
      title: String(rawPicked.title || ''),
      source: String(rawPicked.source || ''),
      url: String(rawPicked.url || ''),
    }
    : (items[0] || null);
  return {
    date: typeof d.date === 'string' ? d.date : '',
    isToday: Boolean(d.isToday),
    generatedAt: typeof d.generatedAt === 'string' ? d.generatedAt : '',
    itemCount: items.length,
    items, // 热点详情页要全量（之前在这里就切成 5 条，详情页只能看见 5 条）
    head: items.slice(0, 5), // 首页卡片固定 5 行
    picked,
  };
}

// ③ 接着写
export async function loadDraftResume() {
  const d = await get('/api/draft/resume');
  // 原样保留服务端的来源标记：首页要靠它判断 posts / my_drafts。
  return {
    id: d.id || '',
    title: d.title || '',
    tail: d.tail || '',
    chars: Number(d.chars) || 0,
    source: typeof d.source === 'string' ? d.source : '',
    table: typeof d.table === 'string' ? d.table : '',
  };
}

// ④ 今日灵感：观点库随机 3 条（走 /api/list，不是 my_views）
export async function loadIdeas() {
  const d = await get('/api/list?limit=120');
  const raw = Array.isArray(d.items) ? d.items : [];
  const shuffled = raw
    .slice()
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map((it) => ({
      id: it.id,
      title: it.claim || '',
      author: it.author || '',
    }));
  return {
    total: Number(d.left) || raw.length,
    items: shuffled,
  };
}

// ⑤ 选题池
export async function loadTopics() {
  const d = await get('/api/topics');
  const items = Array.isArray(d.items) ? d.items : [];
  return {
    total: Number(d.total) || 0,
    minScore: d.minScore === undefined || d.minScore === null ? null : Number(d.minScore),
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

// ⑥ 今日训练次数
export async function loadTrainToday() {
  const d = await get('/api/train/week');
  const doneToday = Array.isArray(d.done) ? d.done : [];
  return {
    count: doneToday.length,
  };
}

// ⑦ 今日字数
export async function loadTodayWords() {
  const d = await get('/api/stats/today');
  const words = Number(d.words) || 0;
  return {
    words,
  };
}

// ⑧ 今日书块
export async function loadTodayBlocks() {
  const d = await get('/api/book/progress/today');
  const blocks = Number(d.blocks) || 0;
  return {
    blocks,
  };
}

// ⑦ 工作台七张功能卡数字
export async function loadWorkbenchStats() {
  try {
    // 用 Promise.all 并发四个接口
    const [statsRes, topicsRes, corpusRes, libraryRes] = await Promise.all([
      get('/api/stats'),
      get('/api/topics?limit=1'), // 只要总数，不需要列表
      get('/api/corpus?limit=1'), // 只要总数，不需要列表
      get('/api/library/stats'),
    ]);

    // 稿库篇数
    const draftsCount = Number(statsRes.posts) || 0;
    const draftsText = `${draftsCount} 篇`;

    // 选题池
    const topicsCount = Number(topicsRes.total) || 0;
    const topicsText = `${topicsCount} 条待写`;

    // 观点库（超过1万用「x.x 万条」）
    const opinionsCount = Number(statsRes.views) || 0;
    let opinionsText;
    if (opinionsCount >= 10000) {
      opinionsText = `${(opinionsCount / 10000).toFixed(1)} 万条`;
    } else {
      opinionsText = `${opinionsCount} 条`;
    }

    // 我的观点 - 需等待后端在 /api/stats 中加 myviews 字段
    const myOpinionsCount = statsRes && statsRes.myviews !== undefined ? Number(statsRes.myviews) || 0 : null;
    const myOpinionsText = myOpinionsCount === null ? '—' : `${myOpinionsCount} 条`;

    // 语料库
    const corpusCount = Number(corpusRes.total) || 0;
    const corpusText = corpusCount > 0 ? `${corpusCount} 条` : '0 条';

    // 书库 - 从 library/stats 的 items 中找
    let booksCount = 0;
    if (Array.isArray(libraryRes.items)) {
      const bookItem = libraryRes.items.find(item => item.k && item.k.includes('书'));
      if (bookItem && bookItem.n) {
        const match = bookItem.n.match(/(\d+)\s*本/);
        if (match) booksCount = Number(match[1]) || 0;
      }
    }
    const booksText = booksCount > 0 ? `${booksCount} 本` : '0 本';

    // 能力表达 - 无现成统计接口
    const abilityText = '—';

    return {
      drafts: draftsText,
      topics: topicsText,
      opinions: opinionsText,
      myOpinions: myOpinionsText,
      corpus: corpusText,
      books: booksText,
      ability: abilityText,
      raw: {
        drafts: draftsCount,
        topics: topicsCount,
        opinions: opinionsCount,
        myOpinions: myOpinionsCount,
        corpus: corpusCount,
        books: booksCount,
        ability: 0,
      },
    };
  } catch (error) {
    // 任何接口失败都返回默认值
    console.warn('加载工作台数据失败:', error.message);
    return {
      drafts: '—',
      topics: '—',
      opinions: '—',
      myOpinions: '—',
      corpus: '—',
      books: '—',
      ability: '—',
      raw: {
        drafts: 0,
        topics: 0,
        opinions: 0,
        myOpinions: 0,
        corpus: 0,
        books: 0,
        ability: 0,
      },
    };
  }
}
