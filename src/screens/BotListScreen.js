import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  PanResponder,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { avatarInk, useTheme } from '../theme';
import { maskFor } from '../avatarMasks';
import { applyOrder, loadOrder, saveOrder } from '../order';
import { advisors } from '../api';

// Bot 列表：未读珊瑚橙胶囊、一键全部已读、长按拖动排序（纯 JS PanResponder，无原生模块）。
// 未读数据源后端还没给，先用 mockUnread 造假数据；接口就位后把 setUnread 换成服务端字段即可。

const ROW_HEIGHT = 84;
const ROW_GAP = 12;
const STRIDE = ROW_HEIGHT + ROW_GAP;
const LONG_PRESS_MS = 300; // 长按 300ms 才进拖动，短按照旧进会话

// TODO(后端): unread 字段就位后删掉这个函数
function mockUnread(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  if (h % 3 === 0) return 0;
  return (h % 15) + 1;
}

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

const AdvisorRow = memo(function AdvisorRow({
  item,
  unread,
  s,
  C,
  scheme,
  dragging,
  onOpen,
  onLongPress,
  panHandlers,
  translateY,
}) {
  const avatar = item.avatar || {};
  const shape = avatar.shape || 'gumdrop';
  const tint = avatar.color ? avatarInk(avatar.color, scheme) : C.ink2;
  return (
    <Animated.View
      style={[s.rowWrap, dragging ? { zIndex: 10, transform: [{ translateY }] } : null]}
      {...panHandlers}
    >
      <Pressable
        style={s.row}
        onPress={() => onOpen(item)}
        onLongPress={onLongPress}
        delayLongPress={LONG_PRESS_MS}
      >
        <Animated.Image
          source={{ uri: maskFor(shape) }}
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
        {unread > 0 ? (
          <View style={[s.badge, { backgroundColor: C.accentCoral }]}>
            <Text style={s.badgeText} allowFontScaling={false}>
              {unread > 99 ? '99+' : String(unread)}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
});

export default function BotListScreen({ onOpen, onSettings }) {
  const { C, T, S, R, scheme } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState([]);
  const [order, setOrder] = useState([]);
  const [unread, setUnread] = useState({});
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dragId, setDragId] = useState(null);
  const dragY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadOrder().then(setOrder);
  }, []);

  const load = useCallback(async (isRefresh) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const list = await advisors();
      setRows(list);
      setErr(null);
      // TODO(后端): 换成服务端 unread
      const m = {};
      list.forEach((it) => {
        m[String(it.id)] = mockUnread(String(it.id));
      });
      setUnread(m);
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

  const sorted = useMemo(() => applyOrder(rows, order), [rows, order]);
  const unreadTotal = useMemo(
    () => sorted.reduce((sum, it) => sum + (unread[String(it.id)] || 0), 0),
    [sorted, unread],
  );

  const reorder = useCallback(
    (fromIndex, dy) => {
      const shift = Math.round(dy / STRIDE);
      const to = Math.max(0, Math.min(sorted.length - 1, fromIndex + shift));
      if (to === fromIndex) return;
      const ids = sorted.map((it) => String(it.id));
      const [moved] = ids.splice(fromIndex, 1);
      ids.splice(to, 0, moved);
      setOrder(ids);
      saveOrder(ids);
    },
    [sorted],
  );

  const openBot = useCallback(
    (bot) => {
      setUnread((prev) => ({ ...prev, [String(bot.id)]: 0 }));
      onOpen(bot);
    },
    [onOpen],
  );

  const clearAll = useCallback(() => {
    setUnread((prev) => {
      const next = {};
      Object.keys(prev).forEach((k) => (next[k] = 0));
      return next;
    });
  }, []);

  // 每行一个响应器：只有长按把 dragId 设成它之后，移动才被接管；短按完全不碰
  const makePan = useCallback(
    (item, index) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: () => dragId === String(item.id),
        onPanResponderMove: (_, g) => dragY.setValue(g.dy),
        onPanResponderRelease: (_, g) => {
          setDragId(null);
          dragY.setValue(0);
          reorder(index, g.dy);
        },
        onPanResponderTerminate: () => {
          setDragId(null);
          dragY.setValue(0);
        },
      }),
    [dragId, dragY, reorder],
  );

  const renderItem = useCallback(
    ({ item, index }) => (
      <AdvisorRow
        item={item}
        unread={unread[String(item.id)] || 0}
        s={s}
        C={C}
        scheme={scheme}
        dragging={dragId === String(item.id)}
        onOpen={openBot}
        onLongPress={() => setDragId(String(item.id))}
        panHandlers={makePan(item, index).panHandlers}
        translateY={dragY}
      />
    ),
    [s, C, scheme, unread, dragId, openBot, makePan, dragY],
  );

  const keyExtractor = useCallback((it) => String(it.id), []);
  const getItemLayout = useCallback(
    (_, index) => ({ length: STRIDE, offset: STRIDE * index, index }),
    [],
  );

  const stepLabel = { login: '登录失败', auth: '认证失败', list: '取顾问列表失败' };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.head}>
        <Text style={s.title} allowFontScaling={false}>
          顾问
        </Text>
        <View style={s.headRight}>
          {unreadTotal > 0 ? (
            <Pressable onPress={clearAll} hitSlop={10} style={s.clearBtn}>
              <Text style={s.clearText} allowFontScaling={false}>
                全部已读
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onSettings} hitSlop={10}>
            <Text style={s.gear} allowFontScaling={false}>
              设置
            </Text>
          </Pressable>
        </View>
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
          data={sorted}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={9}
          removeClippedSubviews={false}
          scrollEnabled={dragId === null}
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
    headRight: { flexDirection: 'row', alignItems: 'center', gap: S.x3 },
    title: { color: C.ink, ...T.display },
    clearBtn: { paddingHorizontal: S.x2, paddingVertical: S.x1 },
    clearText: { color: C.accentCoral, ...T.meta },
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
    rowWrap: { marginHorizontal: S.page, marginBottom: S.x3 },
    row: {
      height: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: S.x4,
      backgroundColor: C.card,
      borderRadius: R.small,
      gap: S.x4,
    },
    mark: { width: 40, height: 40 },
    rowBody: { flex: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: S.x1, marginTop: S.x1 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    status: { color: C.ink2, ...T.meta, flexShrink: 1 },
    name: { color: C.ink, ...T.title },
    badge: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: C.onAccent, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  });
