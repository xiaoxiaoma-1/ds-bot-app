import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { readCached, setCached } from '../../cache';
import { loadBoardSummary } from '../../homeData';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';

// 看板（2026-11-14）。首页四格点进来之后落在这里：
//   四栏 = 待完成 / 进行中 / 阶段完成 / 已完成，四栏都带数量，切栏不换页。
//   卡片字段来自 /api/board/summary 的 cards[]：{id,title,status,nextStep,workspace,updatedAt}
//   status 的取值就是 todo / doing / stage / done —— 和四栏 key 一一对应，字段名对不上会分错栏，
//   所以这里不做任何猜测式映射。
// 点卡片：现在没有独立的看板卡片详情页，先做只读展开（标题 + 下一步 + 工作区 + 更新时间），
// 不接不存在的路由。

const BOARD_TABS = [
  { key: 'todo', label: '待完成' },
  { key: 'doing', label: '进行中' },
  { key: 'stage', label: '阶段完成' },
  { key: 'done', label: '已完成' },
];

export default function BoardScreen({
  status = 'todo',
  onBack,
  activeTab = 'workbench',
  onTabPress,
}) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);

  // 崩溃根因（C1）：useCachedResource 只返回 { data, loading, error }，**没有 refresh()**。
  // 之前这页写 `cached.refresh()`，下拉刷新一碰就是 "cached.refresh is not a function"。
  // 现在这页自己管刷新状态：调 loadBoardSummary 成功后写回缓存，不再调不存在的方法。
  const [board, setBoard] = useState(() => readCached('home:board'));
  const [err, setErr] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [booted, setBooted] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await loadBoardSummary();
      setCached('home:board', d);
      setBoard(d);
      setErr(null);
    } catch (e) {
      // 失败只记错误，保留已有数据，不清屏
      setErr({ message: String((e && e.message) || '读取失败') });
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (!board) await load();
      setBooted(true);
    })();
    // 只在首次挂载跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loading = !board && !err && !booted;
  const cards = Array.isArray(board && board.cards) ? board.cards.filter(Boolean) : [];

  const [tab, setTab] = useState(status);
  const [openId, setOpenId] = useState(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const countOf = (key) => (board && Number(board[key]) ? Number(board[key]) : 0);
  // 元素级空值保护：后端 cards[] 里偶尔会有空项，直接 .status 就抛
  const shown = cards.filter((c) => c && String(c.status || '') === tab);

  // B1：和热点页同一个毛病 —— 头部容器没高度、标题用绝对定位浮着，
  // 于是「看板」大标题被下面的卡片压掉一半。改成真实占位、带底色的头部块，
  // 安全区在原生侧补（SafeAreaView edges=['top']），下面的内容一定排在它之后。
  const Head = () => (
    <SafeAreaView edges={['top']} style={[s.headWrap, { backgroundColor: K.headBg }]}>
      <View style={s.headRow}>
        <Pressable style={s.back} onPress={onBack} accessibilityRole="button" accessibilityLabel="返回">
          <Text style={s.backText} allowFontScaling={false}>‹</Text>
        </Pressable>
        <View style={s.headText}>
          <Text style={s.title} numberOfLines={1} allowFontScaling={false}>看板</Text>
          <Text style={s.subTitle} numberOfLines={1} allowFontScaling={false}>
            {loading ? '正在读取' : `待办 ${countOf('todo')} · 在办 ${countOf('doing')}`}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );

  if (loading) {
    return (
      <View style={s.root}>
        <Head />
        <View style={s.center}>
          <ActivityIndicator color={K.brand} />
        </View>
        {onTabPress && <Dock activeTab={activeTab} onTabPress={onTabPress} />}
      </View>
    );
  }

  return (
    <View style={s.root}>
      <Head />

      {/* 四栏切换：数量跟着分栏走，切栏只换列表不换页 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: S.page, gap: S.x2, paddingBottom: S.x3 }}
        style={s.tabScroll}
      >
        {BOARD_TABS.map((t) => {
          const on = t.key === tab;
          return (
            <Pressable
              key={t.key}
              style={[s.tab, on ? s.tabOn : null]}
              onPress={() => {
                setTab(t.key);
                setOpenId(null);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[s.tabText, on ? s.tabTextOn : null]} allowFontScaling={false}>
                {t.label} {countOf(t.key)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        style={s.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.ink2} />
        }
        contentContainerStyle={{
          paddingHorizontal: S.page,
          paddingBottom: onTabPress ? dockPadding(insets, S) : S.page + insets.bottom,
        }}
      >
        {err ? (
          <View style={s.errorBox}>
            <Text style={s.errorText} allowFontScaling={false}>{err.message || '读取失败'}</Text>
            <Pressable style={s.retryBtn} onPress={onRefresh} accessibilityRole="button">
              <Text style={s.retryText} allowFontScaling={false}>重试</Text>
            </Pressable>
          </View>
        ) : shown.length === 0 ? (
          <Text style={s.empty} allowFontScaling={false}>这一栏现在没有卡片</Text>
        ) : (
          shown.map((c) => {
            const open = openId === c.id;
            return (
              <Pressable
                key={c.id || c.title}
                style={s.card}
                onPress={() => setOpenId(open ? null : c.id)}
                accessibilityRole="button"
              >
                <Text style={s.cardTitle} numberOfLines={open ? undefined : 2} allowFontScaling={false}>
                  {c.title || '（无标题）'}
                </Text>
                {c.nextStep ? (
                  <Text style={s.cardNext} numberOfLines={open ? undefined : 2} allowFontScaling={false}>
                    下一步：{c.nextStep}
                  </Text>
                ) : null}
                {open ? (
                  <View style={s.cardMore}>
                    {c.workspace ? (
                      <Text style={s.cardMeta} allowFontScaling={false}>工作区 {c.workspace}</Text>
                    ) : null}
                    {c.updatedAt ? (
                      <Text style={s.cardMeta} allowFontScaling={false}>更新 {c.updatedAt}</Text>
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {onTabPress && <Dock activeTab={activeTab} onTabPress={onTabPress} />}
    </View>
  );
}

const makeStyles = (C, T, S, R, K) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    headWrap: { paddingBottom: S.x5, borderBottomWidth: 1, borderBottomColor: C.hairline },
    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.x4,
      paddingHorizontal: S.page,
      paddingTop: S.x4,
    },
    back: {
      width: 44,
      height: 44,
      borderRadius: R.capsule,
      backgroundColor: K.edge,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
    },
    backText: { color: C.ink, ...T.title, marginTop: -2 },
    headText: { flex: 1, minWidth: 0 },
    title: { color: K.headOn, ...T.display },
    subTitle: { marginTop: S.x1, color: K.headOnSub, ...T.meta, fontWeight: '500' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    tabScroll: { flexGrow: 0 },
    tab: {
      paddingHorizontal: S.x4,
      paddingVertical: S.x2,
      borderRadius: R.capsule,
      backgroundColor: C.card2,
    },
    tabOn: { backgroundColor: K.headBg },
    tabText: { color: C.ink2, ...T.meta, fontWeight: '500' },
    tabTextOn: { color: K.headOn },
    scroll: { flex: 1 },
    errorBox: {
      marginTop: S.x8,
      padding: S.x4,
      backgroundColor: C.card2,
      borderRadius: R.small,
      alignItems: 'center',
      gap: S.x3,
    },
    errorText: { color: C.bad, ...T.body },
    retryBtn: {
      paddingHorizontal: S.x5,
      paddingVertical: S.x3,
      borderRadius: R.capsule,
      backgroundColor: K.headBg,
    },
    retryText: { color: K.headOn, ...T.title },
    empty: { marginTop: S.x8, color: C.ink3, ...T.meta, textAlign: 'center' },
    card: {
      backgroundColor: C.card,
      borderRadius: R.small,
      padding: S.x4,
      marginBottom: S.x3,
      gap: S.x1,
    },
    cardTitle: { color: C.ink, ...T.body },
    cardNext: { color: C.ink2, ...T.meta },
    cardMore: { marginTop: S.x2, gap: S.x1 },
    cardMeta: { color: C.ink3, ...T.meta },
  });
