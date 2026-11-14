import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useCachedResource, setCached } from '../../cache';
import { loadHotDaily } from '../../homeData';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';

export default function HotDailyScreen({ navigation, onBack, activeTab = 'workbench', onTabPress }) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);

  const cached = useCachedResource('hot:daily:full', loadHotDaily);
  const hot = cached.data;
  const loading = !cached.data && !cached.error;
  const items = Array.isArray(hot?.items) ? hot.items : [];
  const date = hot && !hot.isToday && hot.date ? hot.date + ' 热点' : '今日热点';
  const countText = hot?.itemCount ? `${hot.itemCount} 条` : '';
  // 接口每一条只给 {title, source, url}，没有单条时间；文件级的 generatedAt 用它做统一时间。
  const updatedText = hot?.generatedAt ? '生成于 ' + hot.generatedAt : '';

  // useCachedResource 没有 refresh()（只有 data/loading/error），
  // 之前这里直接调 cached.refresh 一下拉刷新就崩。改成本页自己拉、自己写缓存。
  const [local, setLocal] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const shown = local || hot;
  const itemsShown = Array.isArray(shown?.items) ? shown.items : items;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await loadHotDaily();
      setLocal(fresh);
      setCached('hot:daily:full', fresh);
    } catch (e) {
      // 拉不到就留着旧数据，不打断阅读
    } finally {
      setRefreshing(false);
    }
  }, []);

  const openLink = useCallback((url) => {
    if (!url) return;
    Linking.openURL(url).catch(console.warn);
  }, []);

  // B1：头部原来是「零高度 + 两个绝对定位子元素」——容器高度算出来是 0，
  // 于是列表从 y=0 开始铺、被状态栏压住，标题和返回箭头又浮在第 2、3 条上面。
  // 现在头部是一个真实占位、有底色的块，安全区用 SafeAreaView 在原生侧补，
  // 列表一定排在头部下面；加载态和正常态共用同一块。
  const Head = () => (
    <SafeAreaView edges={['top']} style={[s.headWrap, { backgroundColor: K.headBg }]}>
      <View style={s.headRow}>
        <Pressable style={s.back} onPress={onBack} accessibilityRole="button" accessibilityLabel="返回">
          <Text style={s.backText} allowFontScaling={false}>‹</Text>
        </Pressable>
        <View style={s.headText}>
          <Text style={s.title} numberOfLines={1} allowFontScaling={false}>热点</Text>
          <Text style={s.subTitle} numberOfLines={1} allowFontScaling={false}>
            {loading ? '正在读取' : `${date} · ${countText}${updatedText ? ' · ' + updatedText : ''}`}
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
        {cached.error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText} allowFontScaling={false}>{cached.error.message || '读取失败'}</Text>
            <Pressable style={s.retryBtn} onPress={onRefresh} accessibilityRole="button">
              <Text style={s.retryText} allowFontScaling={false}>重试</Text>
            </Pressable>
          </View>
        ) : itemsShown.length === 0 ? (
          <Text style={s.empty} allowFontScaling={false}>今天的热点还没生成</Text>
        ) : (
          itemsShown.map((it, index) => (
            <Pressable
              key={`hot-${index}-${it.url || ''}`}
              style={s.row}
              onPress={() => openLink(it.url)}
              accessibilityRole="button"
            >
              <Text style={s.ordinal} allowFontScaling={false}>{index + 1}</Text>
              <View style={s.content}>
                <Text style={s.rowTitle} numberOfLines={3} allowFontScaling={false}>
                  {it.title || '（无标题）'}
                </Text>
                {it.source ? (
                  <Text style={s.rowSub} numberOfLines={1} allowFontScaling={false}>
                    来源 {it.source}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))
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
    empty: {
      marginTop: S.x8,
      color: C.ink3,
      ...T.meta,
      textAlign: 'center',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: S.x3,
      paddingVertical: S.x3,
      borderBottomWidth: 1,
      borderBottomColor: C.line,
    },
    ordinal: {
      width: 28,
      color: C.ink2,
      ...T.meta,
      textAlign: 'right',
    },
    content: { flex: 1 },
    rowTitle: { color: C.ink, ...T.body },
    rowSub: { marginTop: S.x1, color: C.ink2, ...T.meta },
  });