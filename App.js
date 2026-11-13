import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ThemeProvider, useTheme } from './src/theme';
import { isConfigured } from './src/store';
import SetupScreen from './src/screens/SetupScreen';
import MainTabs from './src/screens/MainTabs';
import ChatScreen from './src/screens/ChatScreen';
import GroupChatScreen from './src/screens/GroupChatScreen';
import ExpressionScreen from './src/screens/ExpressionScreen';
import BookReaderScreen from './src/screens/workbench/BookReaderScreen';
import { getBookCards, getBookRead, getCorpusViews, postAtomReview, postBookProgress, postExplain } from './src/workbenchApi';
import BooksScreen from './src/screens/workbench/BooksScreen';
import CorpusScreen from './src/screens/workbench/CorpusScreen';
import MyViewsScreen from './src/screens/workbench/MyViewsScreen';
import ViewsDetailScreen from './src/screens/workbench/ViewsDetailScreen';
import ViewsPoolScreen from './src/screens/workbench/ViewsPoolScreen';
import TopicsPoolScreen from './src/screens/workbench/TopicsPoolScreen';
import DraftLibraryScreen from './src/screens/workbench/DraftLibraryScreen';

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
        <Stack.Screen name="DraftLibrary" component={DraftLibraryRoute} />
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
    />
  );
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
  const p = (route && route.params) || {};
  return (
    <DraftLibraryScreen
      {...p}
      onBack={() => navigation.goBack()}
      onTabPress={() => navigation.navigate('BotList')}
    />
  );
}

function TopicsPoolRoute({ route, navigation }) {
  // 业务回调（onRefreshAll / onAnswer / onQuery …）等后端对照表，这里不塞空函数。
  // 数据入参（ViewsDetail 的 topic、BookReader 的 book）从 route.params 取，不给就显示提示而不再往下崩。
  const p = (route && route.params) || {};
  return (
    <TopicsPoolScreen
      {...p}
      onBack={() => navigation.goBack()}
      onTabPress={() => navigation.navigate('BotList')}
    />
  );
}

function ViewsPoolRoute({ route, navigation }) {
  // 业务回调（onRefreshAll / onAnswer / onQuery …）等后端对照表，这里不塞空函数。
  // 数据入参（ViewsDetail 的 topic、BookReader 的 book）从 route.params 取，不给就显示提示而不再往下崩。
  const p = (route && route.params) || {};
  return (
    <ViewsPoolScreen
      {...p}
      onBack={() => navigation.goBack()}
      onTabPress={() => navigation.navigate('BotList')}
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
      onTabPress={() => navigation.navigate('BotList')}
    />
  );
}

function MyViewsRoute({ route, navigation }) {
  // 业务回调（onRefreshAll / onAnswer / onQuery …）等后端对照表，这里不塞空函数。
  // 数据入参（ViewsDetail 的 topic、BookReader 的 book）从 route.params 取，不给就显示提示而不再往下崩。
  const p = (route && route.params) || {};
  return (
    <MyViewsScreen
      {...p}
      onBack={() => navigation.goBack()}
      onTabPress={() => navigation.navigate('BotList')}
    />
  );
}

function CorpusRoute({ navigation }) {
  // 语料库：纯读。onQuery 由页面自己防抖 400ms 后调用。
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(async (kw) => {
    setErr(null);
    try {
      const d = await getCorpusViews({ q: kw, limit: 120 });
      setRows(d.rows);
    } catch (e) {
      setRows([]);
      setErr(e.message);
    }
  }, []);
  useEffect(() => {
    load('');
  }, [load]);
  return (
    <CorpusScreen
      rows={rows === null && !err ? undefined : rows}
      onQuery={(kw) => load(kw)}
      onBack={() => navigation.goBack()}
      onTabPress={() => navigation.navigate('BotList')}
    />
  );
}

function BooksRoute({ navigation }) {
  // 书库：纯读 + 客户端筛选。verdict 是中文（精读/翻翻/跳过），服务端按它过滤。
  const [books, setBooks] = useState(null);
  const [stat, setStat] = useState({});
  const [verdict, setVerdict] = useState('');
  const [err, setErr] = useState(null);
  const load = useCallback(async (v, kw) => {
    setErr(null);
    try {
      const d = await getBookCards({ verdict: v || undefined, q: kw || undefined, limit: 120 });
      setBooks(d.items);
      setStat(d.stat);
    } catch (e) {
      setBooks([]);
      setErr(e.message);
    }
  }, []);
  useEffect(() => {
    load('', '');
  }, [load]);
  return (
    <BooksScreen
      books={books === null && !err ? undefined : books}
      stat={Object.keys(stat).length ? stat : undefined}
      verdict={verdict}
      onFilter={(v) => {
        setVerdict(v);
        load(v, '');
      }}
      onQuery={(kw) => load(verdict, kw)}
      onOpenBook={(item) => navigation.navigate('BookReader', { book: item })}
      onBack={() => navigation.goBack()}
      onTabPress={() => navigation.navigate('BotList')}
    />
  );
}

function BookReaderRoute({ route, navigation }) {
  // 阅读器：进书先拿 savedIdx，再直接跳到上次位置（不让用户自己翻回去）。
  // 页面要的 blocks 是 [{idx,text,heading}]；后端给的是 [{id,from,to,heading,text,chars,junk}]，
  // idx 在容器里按「本次 offset + 序号」算出来。
  const book = (route && route.params && route.params.book) || null;
  const [blocks, setBlocks] = useState([]);
  const [base, setBase] = useState(0);
  const [total, setTotal] = useState(0);
  const [savedIdx, setSavedIdx] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState(null);
  const moreLock = useRef(false);

  const pack = (d, off) => (d.blocks || []).map((b, i) => ({ idx: off + i, text: b.text || '', heading: b.heading || '' }));

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!book || !book.id) return;
      setErr(null);
      try {
        const d0 = await getBookRead({ id: book.id, offset: 0, limit: 20 });
        if (!alive) return;
        setTotal(d0.total);
        const jump = d0.savedIdx || 0;
        setSavedIdx(jump);
        if (jump > 0) {
          // 直接定位到上次读到的块（不再从第一块开始）
          const d1 = await getBookRead({ id: book.id, offset: jump, limit: 20 });
          if (!alive) return;
          setBlocks(pack(d1, jump));
          setBase(jump);
        } else {
          setBlocks(pack(d0, 0));
          setBase(0);
        }
      } catch (e) {
        if (alive) setErr(e.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [book]);

  const onNeedMore = useCallback(
    async (nextOffset) => {
      if (!book || moreLock.current) return;
      moreLock.current = true;
      setLoadingMore(true);
      try {
        const d = await getBookRead({ id: book.id, offset: nextOffset, limit: 20 });
        setBlocks((prev) => prev.concat(pack(d, nextOffset)));
      } catch (e) {
        setErr(e.message);
      } finally {
        setLoadingMore(false);
        moreLock.current = false;
      }
    },
    [book],
  );

  // 页面已防抖 500ms 才会叫到这里；失败静默（记进度不该打扰阅读）
  const onProgress = useCallback(
    (chunkIdx) => {
      if (!book || !book.id) return;
      postBookProgress({ id: book.id, chunkIdx, total }).catch(() => {});
    },
    [book, total],
  );

  return (
    <BookReaderScreen
      book={book}
      blocks={blocks}
      base={base}
      total={total}
      savedIdx={savedIdx}
      loadingMore={loadingMore}
      err={err}
      onNeedMore={onNeedMore}
      onProgress={onProgress}
      onBack={() => navigation.goBack()}
    />
  );
}

const makeStyles = (C, T, S) =>
  StyleSheet.create({
    boot: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: S.x3 },
    bootText: { color: C.ink2, ...T.meta },
  });
