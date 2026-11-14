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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useCachedResource } from '../../cache';
import { loadHotDaily } from '../../homeData';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';

export default function HotDailyScreen({ navigation, onBack, activeTab = 'workbench', onTabPress }) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);

  const cached = useCachedResource('hot:daily:full', loadHotDaily);
  const loading = !cached.data && !cached.error;
  const hot = cached.data;
  const items = Array.isArray(hot?.items) ? hot.items : [];
  const date = hot && !hot.isToday && hot.date ? hot.date + ' 热点' : '今日热点';
  const countText = hot?.itemCount ? `${hot.itemCount} 条` : '';
  // 接口每一条只给 {title, source, url}，没有单条时间；文件级的 generatedAt 用它做统一时间。
  const updatedText = hot?.generatedAt ? '生成于 ' + hot.generatedAt : '';

  const onRefresh = useCallback(() => {
    cached.refresh();
  }, [cached]);

  const openLink = useCallback((url) => {
    if (!url) return;
    Linking.openURL(url).catch(console.warn);
  }, []);

  if (loading) {
    return (
      <View style={s.root}>
        <View style={s.top}>
          <Pressable style={[s.back, { top: insets.top }]} onPress={onBack} accessibilityRole="button">
            <Text style={s.backText} allowFontScaling={false}>‹</Text>
          </Pressable>
          <View style={[s.headText, { top: insets.top + S.x6 * 2 + S.x1 }]}>
            <Text style={s.title} allowFontScaling={false}>热点</Text>
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
          <Text style={s.title} allowFontScaling={false}>热点</Text>
          <Text style={s.subTitle} allowFontScaling={false}>
            {date} · {countText}{updatedText ? ' · ' + updatedText : ''}
          </Text>
        </View>
      </View>

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
        ) : items.length === 0 ? (
          <Text style={s.empty} allowFontScaling={false}>今天的热点还没生成</Text>
        ) : (
          items.map((it, index) => (
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
    top: { position: 'relative' },
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
    headText: {
      position: 'absolute',
      left: S.page + 44 + S.x4,
      right: S.page,
    },
    title: { color: K.onBrand, ...T.display },
    subTitle: { marginTop: S.x1, color: K.onBrand, opacity: 0.78, ...T.meta, fontWeight: '500' },
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
      backgroundColor: K.brand,
    },
    retryText: { color: K.onBrand, ...T.title },
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