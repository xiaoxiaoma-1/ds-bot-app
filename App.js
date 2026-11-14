import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ThemeProvider, useTheme } from './src/theme';
import { isConfigured } from './src/store';
import { warmCache, setCached, setCachedLimited, readCached, useCachedResource } from './src/cache';
import SetupScreen from './src/screens/SetupScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import MainTabs from './src/screens/MainTabs';
import ChatScreen from './src/screens/ChatScreen';
import GroupChatScreen from './src/screens/GroupChatScreen';
import ExpressionScreen from './src/screens/ExpressionScreen';
import BookReaderScreen from './src/screens/workbench/BookReaderScreen';
import {
  delTopic,
  getBookCards,
  getBookRead,
  getCorpusViews,
  getTopics,
  postAtomReview,
  postBookProgress,
  postExplain,
  setTopicStatus,
  startDraft,
  waitDraft,
  getList,
  getMyView,
  getMyViews,
  postViewReview,
  delView,
  postVote,
  undoLast,
  addIdea,
  getBookProgressAll,
} from './src/workbenchApi';
import BooksScreen from './src/screens/workbench/BooksScreen';
import CorpusScreen from './src/screens/workbench/CorpusScreen';
import MyViewsScreen from './src/screens/workbench/MyViewsScreen';
import ViewsDetailScreen from './src/screens/workbench/ViewsDetailScreen';
import ViewsPoolScreen from './src/screens/workbench/ViewsPoolScreen';
import TopicsPoolScreen from './src/screens/workbench/TopicsPoolScreen';
import DraftLibraryScreen from './src/screens/workbench/DraftLibraryScreen';
import IdeaQuickAddScreen from './src/screens/IdeaQuickAddScreen';
import TeamManageScreen from './src/screens/TeamManageScreen';
import HotDailyScreen from './src/screens/workbench/HotDailyScreen';
import BoardScreen from './src/screens/workbench/BoardScreen';

// 导航：原生栈（react-native-screens）。
//   边缘左滑返回靠 gestureEnabled + fullScreenGestureEnabled:false —— 只接管屏幕左边缘 20~30pt，
//   中间区域的横向手势留给页内内容（观点库将来做左右滑不会和返回打架）。
// 深浅色：导航容器自身主题也跟随，避免转场时闪系统默认白底。

const Stack = createNativeStackNavigator();

function navThemeFor(scheme, C) {
  const base = scheme === 'light' ? DefaultTheme : DarkTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      background: C.bg,
      card: C.bg,
      text: C.ink,
      border: 'transparent',
      primary: C.accent,
    },
  };
}

export default function App() {
  const scheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <ThemeProvider scheme={scheme}>
        <NavRoot scheme={scheme} />
      </ThemeProvider>
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
    </SafeAreaProvider>
  );
}

function NavRoot({ scheme }) {
  const { C, S } = useTheme();
  const theme = useMemo(() => navThemeFor(scheme, C), [scheme, C]);

  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator
        initialRouteName="Boot"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          gestureEnabled: true,
          fullScreenGestureEnabled: false,
          fullScreenGestureShadowEnabled: false,
          contentStyle: { backgroundColor: C.bg },
        }}
      >
        <Stack.Screen name="Boot" component={BootScreen} options={{ animation: 'none' }} />
        <Stack.Screen name="Setup" component={SetupRoute} />
        <Stack.Screen name="Profile" component={ProfileRoute} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="BotList" component={BotListRoute} />
        <Stack.Screen name="Chat" component={ChatRoute} />
        <Stack.Screen name="GroupChat" component={GroupChatRoute} />
        <Stack.Screen name="Expression" component={ExpressionRoute} />
        <Stack.Screen name="BookReader" component={BookReaderRoute} />
        <Stack.Screen name="Books" component={BooksRoute} />
        <Stack.Screen name="Corpus" component={CorpusRoute} />
        <Stack.Screen name="MyViews" component={MyViewsRoute} />
        <Stack.Screen name="ViewsDetail" component={ViewsDetailRoute} />
        <Stack.Screen name="ViewsPool" component={ViewsPoolRoute} />
        <Stack.Screen name="TopicsPool" component={TopicsPoolRoute} />
        <Stack.Screen name="IdeaQuickAdd" component={IdeaQuickAddRoute} options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="DraftLibrary" component={DraftLibraryRoute} />
        <Stack.Screen name="HotDaily" component={HotDailyRoute} />
        <Stack.Screen name="Board" component={BoardRoute} />
        <Stack.Screen name="TeamManage" component={TeamManageRoute} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function BootScreen({ navigation }) {
  const { C, T, S } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S), [C, T, S]);
  const [checked, setChecked] = useState(false);

  const boot = useCallback(async () => {
    const ok = await isConfigured();
    // 无感加载：把磁盘缓存读进内存，必须在 replace 之前完成。
    // replace 之后 MainTabs 立刻挂载当前 tab（首页），晚一步就赶不上第一帧，
    // 首页会拿不到缓存 → 先转圈再显示，等于没做。
    try {
      await warmCache();
    } catch {
      // 预热失败不挡启动，退化成「冷启动首屏要请求一次」
    }
    navigation.replace(ok ? 'BotList' : 'Setup');
    setChecked(true);
  }, [navigation]);

  useEffect(() => {
    boot();
  }, [boot]);

  return (
    <View style={s.boot}>
      <ActivityIndicator color={C.accent} />
      {checked ? null : (
        <Text style={s.bootText} allowFontScaling={false}>
          正在读取本机设置
        </Text>
      )}
    </View>
  );
}

function SetupRoute({ navigation }) {
  // 同一屏两用：首次启动时是登录页（无返回），从列表点「设置」进来时是设置页（必须有返回）。
  // 判断依据就是栈里有没有上一层 —— canGoBack()。
  const canGoBack = navigation.canGoBack();
  return (
    <SetupScreen
      onBack={canGoBack ? () => navigation.goBack() : undefined}
      onDone={() => {
        if (navigation.canGoBack()) navigation.goBack();
        else navigation.replace('BotList');
      }}
      onOpenProfile={canGoBack ? () => navigation.navigate('Profile') : undefined}
    />
  );
}

function HotDailyRoute({ navigation }) {
  return (
    <HotDailyScreen
      navigation={navigation}
      onBack={() => navigation.goBack()}
    />
  );
}

// 看板：首页四格（待完成 / 进行中 / 阶段完成 / 已完成）点进来落这里，
// 首页不再原地往下展开，展开那一段已经删掉。status 从首页带过来，决定进来停在哪一栏。
function BoardRoute({ route, navigation }) {
  const status = (route && route.params && route.params.status) || 'todo';
  return <BoardScreen status={status} onBack={() => navigation.goBack()} />;
}

function ProfileRoute({ navigation }) {
  return <ProfileScreen onBack={() => navigation.goBack()} />;
}

function BotListRoute({ navigation }) {
  // MainTabs 自己持有 BotListScreen，并负责底部 dock 与四屏切换。
  // 不要再在这里直接写 <BotListScreen /> —— 少一行 import 就是运行时闪退（Babel/Metro 不查未定义标识符）。
  return <MainTabs navigation={navigation} />;
}

function ChatRoute({ route, navigation }) {
  const bot = route.params?.bot;
  // iOS 的键盘是系统级动画，页面转场一开始就 dismiss 是能拿到的最早时机；
  // 系统仍可能让它比页面慢一拍（见交付说明）。
  useEffect(() => {
    const offStart = navigation.addListener('transitionStart', (e) => {
      if (e && e.data && e.data.closing) Keyboard.dismiss();
    });
    const offRemove = navigation.addListener('beforeRemove', () => Keyboard.dismiss());
    return () => {
      offStart && offStart();
      offRemove && offRemove();
    };
  }, [navigation]);
  const { C, T, S } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S), [C, T, S]);
  if (!bot || !bot.id) {
    return (
      <View style={s.boot}>
        <Text style={s.bootText} allowFontScaling={false}>
          会话参数丢了，正在返回
        </Text>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={[s.bootText, { color: C.accent }]} allowFontScaling={false}>
            返回
          </Text>
        </Pressable>
      </View>
    );
  }
  return <ChatScreen bot={bot} onBack={() => navigation.goBack()} />;
}

function ExpressionRoute({ navigation }) {
  // 能力表达整屏（三阶段 + 流式点评）；点评走 sse.js 的 readEventStream，可被 AbortController 中止
  return <ExpressionScreen onBack={() => navigation.goBack()} />;
}

function IdeaQuickAddRoute({ navigation }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const onSave = async (text) => {
    setSaving(true);
    setErr(null);
    try {
      await addIdea(text);
      navigation.goBack();
    } catch (e) {
      setErr(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };
  return (
    <IdeaQuickAddScreen
      onSave={onSave}
      onClose={() => navigation.goBack()}
      saving={saving}
      error={err}
    />
  );
}

function GroupChatRoute({ route, navigation }) {
  const group = route.params?.bot;
  const { C, T, S } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S), [C, T, S]);
  if (!group || !group.id) {
    return (
      <View style={s.boot}>
        <Text style={s.bootText} allowFontScaling={false}>
          群参数丢了，正在返回
        </Text>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={[s.bootText, { color: C.accent }]} allowFontScaling={false}>
            返回
          </Text>
        </Pressable>
      </View>
    );
  }
  return <GroupChatScreen group={group} onBack={() => navigation.goBack()} />;
}

function DraftLibraryRoute({ route, navigation }) {
  // 业务回调（onRefreshAll / onAnswer / onQuery …）等后端对照表，这里不塞空函数。
  // 数据入参（ViewsDetail 的 topic、BookReader 的 book）从 route.params 取，不给就显示提示而不再往下崩。
  // draftId（来自 MainTabs 首页「接着写」点击）已接参数，待页面支持定位到指定草稿。
  const p = (route && route.params) || {};
  return (
    <DraftLibraryScreen
      {...p}
      onBack={() => navigation.goBack()}
      
    />
  );
}

function TeamManageRoute({ navigation }) {
  return <TeamManageScreen onBack={() => navigation.goBack()} />;
}

function buildBoardCounts(items = []) {
  const n = {};
  for (const it of items) if (it.board) n[it.board] = (n[it.board] || 0) + 1;
  return Object.keys(n).map((b) => ({ board: b, n: n[b] }));
}

function TopicsPoolRoute({ navigation }) {
  // 选题池：/api/topics 的筛选参数全被服务端忽略（total 恒 112、items 恒 30），
  // 所以 boards 的条数只能拿这 30 条自己数，minScore 也交给页面本地筛。
  const cachedTopics = useCachedResource('workbench:topics', getTopics);
  const [patch, setPatch] = useState(null);
  const [err, setErr] = useState(null);

  const topics = patch ? patch.items : cachedTopics.data ? cachedTopics.data.items : null;
  const boards = useMemo(() => buildBoardCounts(topics || []), [topics]);
  const loading = !topics && !cachedTopics.error;

  const load = useCallback(async () => {
    setErr(null);
    try {
      const d = await getTopics();
      setCached('workbench:topics', d);
      setPatch({ items: Array.isArray(d.items) ? d.items : [] });
    } catch (e) {
      // 有旧数据就保留，不把已有选题清空。
      setErr(e.message);
    }
  }, []);

  // 「刷新全部」：服务端没有这接口，就重拉一次 /api/topics，并用 onProgress 报真实进度
  const onRefreshAll = useCallback(
    async ({ onProgress } = {}) => {
      if (onProgress) onProgress({ done: 0, total: 1, current: '读取选题' });
      await load();
      if (onProgress) onProgress({ done: 1, total: 1, current: '完成' });
    },
    [load],
  );

  // 写稿：POST /api/draft 拿 task → 2 秒一轮轮询 draft_status → done 的整段 text 一次性喂 onChunk
  const onWriteDraft = useCallback(async (topic, { rewrite, onChunk } = {}) => {
    const task = await startDraft(topic.id, { rewrite: !!rewrite });
    const { text } = await waitDraft(task, {
      intervalMs: 2000,
      timeoutMs: 90000,
    });
    if (onChunk) onChunk(text || '');
    return text;
  }, []);

  const onChangeStatus = useCallback(
    async (topic, next) => {
      try {
        await setTopicStatus(topic.id, next);
        setPatch((prev) => ({
          items: (prev ? prev.items : topics || []).map((x) => (x.id === topic.id ? { ...x, status: next } : x)),
        }));
      } catch (e) {
        setErr(e.message);
      }
    },
    [topics],
  );

  const onDelete = useCallback(async (topic) => {
    try {
      const r = await delTopic(topic.id);
      setPatch((prev) => ({
        items: (prev ? prev.items : topics || []).filter((x) => x.id !== topic.id),
      }));
      if (!r.ok && !r.gone) setErr('删不掉');
    } catch (e) {
      setErr(e.message);
    }
  }, [topics]);

  return (
    <TopicsPoolScreen
      topics={topics || []}
      boards={boards}
      loading={loading && (topics || []).length === 0}
      error={err || (!topics ? cachedTopics.error : null) || undefined}
      onRetry={() => load()}
      onRefreshAll={onRefreshAll}
      onWriteDraft={onWriteDraft}
      onChangeStatus={onChangeStatus}
      onDelete={onDelete}
      onBack={() => navigation.goBack()}
    />
  );
}

function ViewsPoolRoute({ navigation, route }) {
  // 观点库：一条平铺流。后端 /api/list 用 `not in (my_views where kind='clash')` 过滤，
  // 所以「投过的自然消失」——投票成功后必须**重拉**，不本地删。
  const selected = (route && route.params && Array.isArray(route.params.selected))
    ? route.params.selected
    : null;
  const selectedKey = selected && selected.length ? selected.join(',') : 'all';
  // key 不带 selected：首页每次随机 3 条也不换缓存，第二次进来第一帧仍有内容；
  // selected 只在装载函数里重排，后台刷新再替换。
  const cacheKey = 'workbench:views:all';

  const loadPool = useCallback(async () => {
    // 带 selected（从首页「今日灵感」那 3 条进来）时，首屏一次拉 120 条：
    // 那 3 条是首页从 /api/list?limit=120 里随机抽的，只拉 20 条大概率筛不到，
    // 筛不到就会掉进下面 getMyView 那条死路（getMyView 查的是 my_views 表，atoms id 永远查不到）。
    const limit = selected && selected.length ? 120 : 20;
    const d = await getList({ offset: 0, limit });
    let items = d.items;
    if (selected && selected.length) {
      const want = new Set(selected);
      const picked = items.filter((x) => want.has(x.id));
      const rest = items.filter((x) => !want.has(x.id));
      // 120 条里还筛不到，说明那几条已经被别人表态过、被 /api/list 的
      // `not in (select topic_id from my_views where kind='clash')` 过滤掉了。
      // 这种情况下不补、不报错，直接少显示，别去 getMyView 那条查 my_views 的死路。
      const missing = selected.filter((id) => !picked.some((x) => x.id === id));
      if (missing.length) {
        console.log('[views] selected not in list (already voted):', missing);
      }
      items = [...picked, ...rest];
    }
    return { ...d, items };
  }, [selectedKey]);

  const cachedViews = useCachedResource(cacheKey, loadPool);
  const [live, setLive] = useState(null);
  const [err, setErr] = useState(null);
  const voteLock = useRef(false);
  const lastVoteAt = useRef(0);

  const data = live || cachedViews.data;
  const topics = data ? data.items : cachedViews.error ? [] : undefined;
  const left = data ? data.left : 0;
  const done = data ? data.done : 0;

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const d = await loadPool();
      setCached(cacheKey, d);
      setLive(d);
    } catch (e) {
      setErr(e.message);
    }
  }, [loadPool, cacheKey]);

  const onNeedMore = useCallback(async () => {
    if (!data) return;
    try {
      const d = await getList({ offset: data.nextOffset || 0, limit: 20 });
      const next = {
        ...data,
        items: (data.items || []).concat(d.items || []),
        left: d.left,
        done: d.done,
        nextOffset: d.nextOffset,
      };
      setCached(cacheKey, next);
      setLive(next);
    } catch (e) {
      setErr(e.message);
    }
  }, [data, cacheKey]);

  // 表态：1 秒防抖（created_at 秒级）+ 成功后重拉
  const onAnswer = useCallback(
    async (cur, verdict, why) => {
      if (voteLock.current) return;
      const now = Date.now();
      if (now - lastVoteAt.current < 1000) return;
      voteLock.current = true;
      lastVoteAt.current = now;
      try {
        const r = await postVote({ atomId: cur.id, verdict, why });
        if (r.gone) {
          // 这条观点已经不存在 → 重拉即可，不弹错误
          await reload();
          return;
        }
        await reload();
      } catch (e) {
        setErr(e.message);
      } finally {
        voteLock.current = false;
      }
    },
    [reload],
  );

  // 撤销：后端撤的是「最近一次表态」，不是屏幕上这条 → 必须重拉
  const onUndo = useCallback(async () => {
    try {
      await undoLast();
    } catch (e) {
      // 「还没有表态过，撤不回」也走这里，原样给页面（它自己决定怎么提示）
      throw e;
    } finally {
      await reload();
    }
  }, [reload]);

  return (
    <ViewsPoolScreen
      topics={topics}
      left={left}
      done={done}
      autoSwipe={Boolean(selected && selected.length)}
      loading={!data}
      error={err || (data ? null : cachedViews.error) || null}
      onRetry={() => {
        setErr(null);
        reload();
      }}
      onAnswer={onAnswer}
      onNeedMore={onNeedMore}
      onUndo={onUndo}
      onOpenDetail={(cur) => navigation.navigate('ViewsDetail', { topic: cur })}
      onBack={() => navigation.goBack()}
    />
  );
}

function ViewsDetailRoute({ route, navigation }) {
  // 观点详情：两条都是慢接口（atom/review 实测 9.4s、讲透 5.4s，客户端给 90s）。
  // review 的形态照 ReviewBlock 要的字段给：{loading} / {error} / {score,verdict,pros,gaps,questions,one_line}
  const topic = (route && route.params && route.params.topic) || null;
  const [review, setReview] = useState(null);
  const [explain, setExplain] = useState(null);
  const lockReview = useRef(false);
  const lockExplain = useRef(false);

  const doReview = useCallback(async () => {
    if (!topic || !topic.id || lockReview.current) return;
    lockReview.current = true;
    setReview({ loading: true });
    try {
      const d = await postAtomReview(topic.id);
      setReview(d.review || { error: '评审没有返回内容' });
    } catch (e) {
      setReview({ error: e.message });
    } finally {
      lockReview.current = false;
    }
  }, [topic]);

  const doExplain = useCallback(async () => {
    if (!topic || lockExplain.current) return;
    lockExplain.current = true;
    setExplain({ loading: true });
    try {
      const text = await postExplain(topic.claim || '');
      setExplain({ text: text || '', loading: false });
    } catch (e) {
      setExplain({ error: e.message });
    } finally {
      lockExplain.current = false;
    }
  }, [topic]);

  return (
    <ViewsDetailScreen
      topic={topic}
      review={review}
      explain={explain}
      onReview={doReview}
      onExplain={doExplain}
      onBack={() => navigation.goBack()}
      
    />
  );
}

function MyViewsRoute({ navigation }) {
  // 我的观点：列表 /api/myviews（固定 30 条，含 review 对象）；
  // 展开某条再 GET /api/myview?id= 拿正文；评审 POST /api/view_review（90s）；删除 POST /api/view_del。
  // 页面要的 detail 形态照它自己的注释：{ id, loading, error, view:{content, created_at, ai_review} }
  const cachedMyViews = useCachedResource('workbench:myviews', getMyViews);
  const [live, setLive] = useState(null);
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(null);
  const reviewLock = useRef(false);

  const data = live || cachedMyViews.data;
  const views = data ? data.items : cachedMyViews.error ? [] : undefined;

  const load = useCallback(async () => {
    setErr(null);
    try {
      const d = await getMyViews();
      setCached('workbench:myviews', d);
      setLive(d);
    } catch (e) {
      // 有缓存就保留缓存，不清空列表。
      setErr(e.message);
    }
  }, []);

  const onOpen = useCallback(async (id) => {
    const seed = (views || []).find((v) => v.id === id);
    setDetail({ id, loading: true });
    try {
      const d = await getMyView(id);
      setDetail({
        id,
        loading: false,
        // ai_review 从列表那条带过来（/api/myview 只给 content/at，不含评审）
        view: {
          id: d.id,
          title: d.title,
          content: d.content,
          created_at: d.at,
          ai_review: seed && seed.review && Object.keys(seed.review).length ? seed.review : null,
        },
      });
    } catch (e) {
      setDetail({ id, loading: false, error: '读不到这条：' + e.message });
    }
  }, [views]);

  const onClose = useCallback(() => setDetail(null), []);

  const onReview = useCallback(
    async (id) => {
      if (reviewLock.current) return;
      reviewLock.current = true;
      try {
        const d = await postViewReview(id);
        setDetail((prev) =>
          prev && prev.id === id && prev.view ? { ...prev, view: { ...prev.view, ai_review: d.review } } : prev,
        );
        await load();
      } catch (e) {
        setDetail((prev) => (prev && prev.id === id ? { ...prev, error: '评审失败：' + e.message } : prev));
      } finally {
        reviewLock.current = false;
      }
    },
    [load],
  );

  const onDelete = useCallback(
    async (v) => {
      try {
        const r = await delView(v.id);
        // 「找不到这条观点」= 别处已删，本地也移除，不弹错
        if (!r.ok && !r.gone) setErr('删不掉这条');
      } catch (e) {
        setErr(e.message);
        return;
      }
      const next = { ...(data || { total: 0 }), items: (data?.items || []).filter((x) => x.id !== v.id) };
      setCached('workbench:myviews', next);
      setLive(next);
      setDetail((prev) => (prev && prev.id === v.id ? null : prev));
    },
    [data],
  );

  return (
    <MyViewsScreen
      views={views}
      detail={detail}
      error={err || (data ? null : cachedMyViews.error) || null}
      onRetry={() => {
        setErr(null);
        load();
      }}
      onOpen={onOpen}
      onClose={onClose}
      onReview={onReview}
      onDelete={onDelete}
      onBack={() => navigation.goBack()}
    />
  );
}

function CorpusRoute({ navigation }) {
  // 语料库：纯读。搜索词变了就换缓存 key，命中缓存先渲染，后台再静默刷新。
  const [query, setQuery] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  const corpusKey = `corpus:${query || 'all'}:${retryTick}`;
  const cachedCorpus = useCachedResource(corpusKey, () => getCorpusViews({ q: query, limit: 120 }));

  return (
    <CorpusScreen
      rows={cachedCorpus.data ? cachedCorpus.data.rows : undefined}
      loading={!cachedCorpus.data && !cachedCorpus.error}
      onQuery={(kw) => setQuery(kw)}
      onRetry={() => setRetryTick((n) => n + 1)}
      onDelete={async (row) => {
        // 语料库和我的观点同一张表，删除复用 delView（F2）
        await delView(row.id);
        setRetryTick((n) => n + 1);
      }}
      // 移回「我的观点」后端还没有接口，这里不传 onMoveBack，按钮上标「待接入」（F3）
      onBack={() => navigation.goBack()}
      error={cachedCorpus.error || undefined}
    />
  );
}

function BooksRoute({ navigation }) {
  // 书库：纯读 + 客户端筛选。verdict 是中文（精读/翻翻/跳过），服务端按它过滤。
  const [verdict, setVerdict] = useState('');
  const [query, setQuery] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  const booksKey = `books:${verdict || 'all'}:${query || 'all'}:${retryTick}`;
  const cachedBooks = useCachedResource(booksKey, () => getBookCards({
    verdict: verdict || undefined,
    q: query || undefined,
    limit: 120,
  }));
  const cachedProgress = useCachedResource('books:progress', getBookProgressAll);

  const handleFilter = useCallback((v) => {
    setVerdict(v);
    setQuery('');
  }, []);

  const handleQuery = useCallback((kw) => {
    setQuery(kw);
  }, []);

  return (
    <BooksScreen
      books={cachedBooks.data ? cachedBooks.data.items : undefined}
      prog={cachedProgress.data || {}}
      stat={cachedBooks.data ? cachedBooks.data.stat : undefined}
      verdict={verdict}
      loading={!cachedBooks.data && !cachedBooks.error}
      onFilter={handleFilter}
      onQuery={handleQuery}
      onOpenBook={(item) => navigation.navigate('BookReader', { book: item })}
      onBack={() => navigation.goBack()}
      error={cachedBooks.error || undefined}
      onRetry={() => setRetryTick((n) => n + 1)}
    />
  );
}

function BookReaderRoute({ route, navigation }) {
  // 阅读器：进书先拿 savedIdx，再直接跳到上次位置（不让用户自己翻回去）。
  // 页面要的 blocks 是 [{idx,text,heading}]；后端给的是 [{id,from,to,heading,text,chars,junk}]，
  // idx 在容器里按「本次 offset + 序号」算出来。
  const book = (route && route.params && route.params.book) || null;
  const bookId = book && book.id ? String(book.id) : '';
  const [blocks, setBlocks] = useState([]);
  const [base, setBase] = useState(0);
  const [total, setTotal] = useState(0);
  const [savedIdx, setSavedIdx] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const moreLock = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const pack = (d, off) => (d.blocks || []).map((b, i) => ({ idx: off + i, text: b.text || '', heading: b.heading || '' }));

  // 正文缓存（E5）：key 就是 `book:<id>:<offset>`，一块不落。
  // 上限 20 本 × 最新 30 块 = 600 条（一本书一次拉 20 块，正常读到 30 块就会命中前两屏）。
  const bookKey = (off) => 'book:' + bookId + ':' + off;
  const cacheBlock = (off, list) => {
    try {
      setCachedLimited(bookKey(off), list, { prefix: 'book:', max: 600 });
    } catch (e) {
      // 存不进就算了，不能因为缓存把阅读搞崩
    }
  };

  const reload = useCallback(async () => {
    if (!bookId) {
      setErr('没有传入书籍信息');
      setInitialLoading(false);
      return;
    }
    // ① 先吃缓存：有缓存就先把首屏渲染出来，再静默拉新（不用每次都干等）
    const cached0 = readCached(bookKey(0));
    if (Array.isArray(cached0) && cached0.length) {
      setBlocks(cached0);
      setBase(0);
      setInitialLoading(false);
    }
    setErr(null);
    if (!Array.isArray(cached0) || !cached0.length) setInitialLoading(true);
    try {
      const d0 = await getBookRead({ id: bookId, offset: 0, limit: 20 });
      if (!aliveRef.current) return;
      const totalN = Number(d0.total) || 0;
      setTotal(totalN);
      // savedIdx 越界会请求到空块；夹在 0..total-1，避免第一屏白屏。
      const jump = Math.max(0, Math.min(Number(d0.savedIdx) || 0, Math.max(0, totalN - 1)));
      setSavedIdx(jump);
      const first = pack(d0, 0);
      cacheBlock(0, first);
      if (jump > 0) {
        const cachedJump = readCached(bookKey(jump));
        // G1：定位那一段还没回来时，先把第 0 段铺上去，用户至少能立刻看到正文，
        // 不再是一个「正在加载中」干等两个串行请求。
        if (!(Array.isArray(cachedJump) && cachedJump.length) && first.length) {
          setBlocks(first);
          setBase(0);
        }
        if (Array.isArray(cachedJump) && cachedJump.length) {
          setBlocks(cachedJump);
          setBase(jump);
        }
        try {
          const d1 = await getBookRead({ id: bookId, offset: jump, limit: 20 });
          if (!aliveRef.current) return;
          const jumped = pack(d1, jump);
          cacheBlock(jump, jumped);
          setBlocks(jumped);
          setBase(jump);
        } catch (jumpErr) {
          // 定位失败时退回第一段，至少让正文能读；不把整本书卡死。
          if (!aliveRef.current) return;
          if (!(Array.isArray(cachedJump) && cachedJump.length)) {
            setBlocks(first);
            setBase(0);
            setSavedIdx(0);
          }
        }
      } else {
        setBlocks(first);
        setBase(0);
      }
    } catch (e) {
      if (aliveRef.current) {
        // 已有缓存内容时不把错误盖在正文上，只提示一句
        setErr(Array.isArray(cached0) && cached0.length ? null : `${bookId} · offset=0 · limit=20 · ${e.message}`);
      }
    } finally {
      if (aliveRef.current) setInitialLoading(false);
    }
  }, [bookId]);

  useEffect(() => { reload(); }, [reload]);

  const onNeedMore = useCallback(
    async (nextOffset) => {
      if (!bookId || moreLock.current) return;
      moreLock.current = true;
      setLoadingMore(true);
      try {
        const cachedNext = readCached(bookKey(nextOffset));
        if (Array.isArray(cachedNext) && cachedNext.length) {
          setBlocks((prev) => prev.concat(cachedNext));
          return;
        }
        const d = await getBookRead({ id: bookId, offset: nextOffset, limit: 20 });
        const next = pack(d, nextOffset);
        cacheBlock(nextOffset, next);
        setBlocks((prev) => prev.concat(next));
      } catch (e) {
        setErr(e.message);
      } finally {
        setLoadingMore(false);
        moreLock.current = false;
      }
    },
    [bookId],
  );

  // 页面已防抖 500ms 才会叫到这里；失败静默（记进度不该打扰阅读）
  const onProgress = useCallback(
    (chunkIdx) => {
      if (!bookId) return;
      postBookProgress({ id: bookId, chunkIdx, total }).catch(() => {});
    },
    [bookId, total],
  );

  return (
    <BookReaderScreen
      book={book}
      blocks={blocks}
      base={base}
      total={total}
      savedIdx={savedIdx}
      loadingMore={loadingMore}
      initialLoading={initialLoading}
      err={err}
      onNeedMore={onNeedMore}
      onProgress={onProgress}
      onRetry={reload}
      onBack={() => navigation.goBack()}
    />
  );
}

const makeStyles = (C, T, S) =>
  StyleSheet.create({
    boot: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: S.x3 },
    bootText: { color: C.ink2, ...T.meta },
  });
