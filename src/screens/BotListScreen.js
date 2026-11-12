import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, avatarInk } from '../theme';
import { maskFor } from '../avatarMasks';
import { advisors } from '../api';

// 功能一：Bot 列表。四态：loading / failed / empty / list。
// 令牌 v4：无分割线、无投影、无描边。
// 头像：白 mask PNG + tintColor 染色（图里没有烧死的颜色）；形状/颜色都来自电脑端 avatar 字段。

const ROW_HEIGHT = 84;

function statusText(item) {
  const st = String(item.status || 'unknown');
  if (st === 'busy') {
    const extra = item.tool || item.activity || '';
    return extra ? `在忙 · ${extra}` : '在忙';
  }
  if (st === 'idle') return '空闲';
  return '状态未知';
}

function dotColor(status, C) {
  const v = String(status || 'unknown');
  if (v === 'busy') return C.accent;
  if (v === 'idle') return C.good;
  return C.ink3;
}

const AdvisorRow = memo(function AdvisorRow({ item, onOpen, C, s, scheme }) {
  const avatar = item.avatar || {};
  const shape = avatar.shape || 'gumdrop'; // 与电脑端 FALLBACK_SHAPE 一致
  const tint = avatar.color ? avatarInk(avatar.color, scheme) : C.ink2;
  return (
    <Pressable style={s.row} onPress={() => onOpen(item)}>
      <Image
        source={{ uri: maskFor(shape, 40) }}
        style={[s.mark, { tintColor: tint }]}
        resizeMode="contain"
      />
      <View style={s.rowBody}>
        <Text style={s.name} numberOfLines={1} allowFontScaling={false}>
          {item.name}
        </Text>
        <View style={s.metaRow}>
          <View style={[s.dot, { backgroundColor: dotColor(item.status, C) }]} />
          <Text style={s.status} numberOfLines={1} allowFontScaling={false}>
            {statusText(item)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

export default function BotListScreen({ onOpen, onSettings }) {
  const { C, T, S, R, scheme } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const list = await advisors();
      setRows(list);
      setErr(null);
    } catch (e) {
      setRows([]);
      setErr({ step: e.step || 'list', message: e.message || '未知错误' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const renderItem = useCallback(
    ({ item }) => <AdvisorRow item={item} onOpen={onOpen} C={C} s={s} scheme={scheme} />,
    [onOpen, C, s, scheme],
  );
  const keyExtractor = useCallback((it) => String(it.id), []);
  const getItemLayout = useCallback(
    (_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index }),
    [],
  );

  const stepLabel = { login: '登录失败', auth: '认证失败', list: '取顾问列表失败' };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.head}>
        <Text style={s.title} allowFontScaling={false}>
          顾问
        </Text>
        <Pressable onPress={onSettings} hitSlop={12}>
          <Text style={s.gear} allowFontScaling={false}>
            设置
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.accent} />
          <Text style={s.centerText} allowFontScaling={false}>
            正在取顾问列表
          </Text>
        </View>
      ) : err ? (
        <View style={s.errBox}>
          <Text style={s.errTitle} allowFontScaling={false}>
            {stepLabel[err.step] || '出错了'}
          </Text>
          <Text style={s.errMsg} allowFontScaling={false}>
            {err.message}
          </Text>
          <View style={s.errActions}>
            <Pressable style={s.errBtn} onPress={() => load(false)}>
              <Text style={s.errBtnText} allowFontScaling={false}>
                重试
              </Text>
            </Pressable>
            <Pressable style={s.errBtnGhost} onPress={onSettings}>
              <Text style={s.errBtnGhostText} allowFontScaling={false}>
                去改地址/口令
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={{ paddingBottom: insets.bottom + S.x5 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.ink2} />
          }
          ListEmptyComponent={
            <View style={s.center}>
              <Text style={s.emptyTitle} allowFontScaling={false}>
                一个顾问都没有
              </Text>
              <Text style={s.centerText} allowFontScaling={false}>
                列表拉取成功，但电脑那边返回的是空数组
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const makeStyles = (C, T, S, R) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    head: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      paddingHorizontal: S.page,
      paddingTop: S.x3,
      paddingBottom: S.x4,
    },
    title: { color: C.ink, ...T.display },
    gear: { color: C.ink2, ...T.meta },
    center: { alignItems: 'center', justifyContent: 'center', paddingVertical: S.x8, gap: S.x3 },
    centerText: { color: C.ink3, ...T.meta, textAlign: 'center' },
    emptyTitle: { color: C.ink2, ...T.body },
    errBox: {
      margin: S.page,
      padding: S.card,
      backgroundColor: C.card,
      borderRadius: R.big,
      gap: S.x2,
    },
    errTitle: { color: C.bad, ...T.title },
    errMsg: { color: C.ink2, ...T.body },
    errActions: { flexDirection: 'row', gap: S.x3, marginTop: S.x1 },
    errBtn: {
      backgroundColor: C.accent,
      borderRadius: R.capsule,
      paddingHorizontal: S.x4,
      paddingVertical: S.x2,
    },
    errBtnText: { color: C.onAccent, ...T.meta },
    errBtnGhost: { borderRadius: R.capsule, paddingHorizontal: S.x4, paddingVertical: S.x2 },
    errBtnGhostText: { color: C.ink2, ...T.meta },
    row: {
      height: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: S.page,
      marginBottom: S.x3,
      paddingHorizontal: S.x4,
      backgroundColor: C.card,
      borderRadius: R.small,
      gap: S.x4,
    },
    // 头像：40px 白 mask，颜色靠 tintColor 染（图里没有烧死的颜色）
    mark: { width: 40, height: 40 },
    rowBody: { flex: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: S.x1, marginTop: S.x1 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    status: { color: C.ink2, ...T.meta, flexShrink: 1 },
    name: { color: C.ink, ...T.title },
  });
