import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useCachedResource } from '../../cache';
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

  const cached = useCachedResource('home:board', loadBoardSummary);
  const loading = !cached.data && !cached.error;
  const board = cached.data;
  const cards = Array.isArray(board?.cards) ? board.cards : [];

  const [tab, setTab] = useState(status);
  const [openId, setOpenId] = useState(null);

  const onRefresh = useCallback(() => {
    cached.refresh();
  }, [cached]);

  const countOf = (key) => (board ? Number(board[key]) || 0 : 0);
  const shown = cards.filter((c) => String(c.status || '') === tab);

  if (loading) {
    return (
      <View style={s.root}>
        <View style={s.top}>
          <Pressable style={[s.back, { top: insets.top }]} onPress={onBack} accessibilityRole="button">
            <Text style={s.backText} allowFontScaling={false}>‹</Text>
          </Pressable>
          <View style={[s.headText, { top: insets.top + S.x6 * 2 + S.x1 }]}>
            <Text style={s.title} allowFontScaling={false}>看板</Text>
            <Text style={s.subTitle} allowFontScaling={false}>正在读取</Text>
          </View>
        </View>
        <View style={s.center}>
          <ActivityIndicator color={K.brand} />
        </View>
        {onTabPress && <Dock activeTab={activeTab} onTabPress={onTabPress} />}
      </View>
    );
  }

  return (
    <View style={s.root}>
      <View style={s.top}>
        <Pressable style={[s.back, { top: insets.top }]} onPress={onBack} accessibilityRole="button">
          <Text style={s.backText} allowFontScaling={false}>‹</Text>
        </Pressable>
        <View style={[s.headText, { top: insets.top + S.x6 * 2 + S.x1 }]}>
          <Text style={s.title} allowFontScaling={false}>看板</Text>
          <Text style={s.subTitle} allowFontScaling={false}>
            待办 {countOf('todo')} · 在办 {countOf('doing')}
          </Text>
        </View>
      </View>

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
          <RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={C.ink2} />
        }
        contentContainerStyle={{
          paddingHorizontal: S.page,
          paddingBottom: onTabPress ? dockPadding(insets, S) : S.page + insets.bottom,
        }}
      >
        {cached.error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText} allowFontScaling={false}>{cached.error.message || '读取失败'}</Text>
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
    top: { position: 'relative', minHeight: 100 },
    back: {
      position: 'absolute',
      left: S.page,
      width: 44,
      height: 44,
      borderRadius: R.capsule,
      backgroundColor: K.edge,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
    },
    backText: { color: C.ink, ...T.title, marginTop: -2 },
    headText: { position: 'absolute', left: S.page + 44 + S.x4, right: S.page },
    title: { color: K.onBrand, ...T.display },
    subTitle: { marginTop: S.x1, color: K.onBrand, opacity: 0.78, ...T.meta, fontWeight: '500' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    tabScroll: { flexGrow: 0 },
    tab: {
      paddingHorizontal: S.x4,
      paddingVertical: S.x2,
      borderRadius: R.capsule,
      backgroundColor: C.card2,
    },
    tabOn: { backgroundColor: K.brand },
    tabText: { color: C.ink2, ...T.meta, fontWeight: '500' },
    tabTextOn: { color: K.onBrand },
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
      backgroundColor: K.brand,
    },
    retryText: { color: K.onBrand, ...T.title },
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
