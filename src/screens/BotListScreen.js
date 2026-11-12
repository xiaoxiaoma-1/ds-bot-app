import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
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
import BotMenu from './botMenu';
import { botApi } from '../botApi';
import { advisorsFull } from '../api';
import { groupsUnreadCount, normalizeGroups } from '../groups';
import GroupSection from './GroupSection';

// Bot 列表：未读珊瑚橙胶囊、一键全部已读、长按弹菜单（移动/编辑/隐藏/删除）。
// 拖动入口只在菜单里选「移动」之后开启：此时每行右侧出现把手，拖完点右上「完成」退出。
// 行高不写魔数：ROW_H 与 ROW_GAP 只在样式常量里定义一次，拖动步长优先用 onLayout 实测值。

const ROW_H = 84;
const ROW_GAP = 12;
const LONG_PRESS_MS = 300;


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
  dragMode,
  dragging,
  onOpen,
  onLongPress,
  onMeasured,
  panHandlers,
  translateY,
}) {
  const avatar = item.avatar || {};
  const shape = avatar.shape || 'gumdrop';
  const tint = avatar.color ? avatarInk(avatar.color, scheme) : C.ink2;
  return (
    <Animated.View
      onLayout={onMeasured}
      style={[s.rowWrap, dragging ? { zIndex: 20, transform: [{ translateY }] } : null]}
    >
      <Pressable
        style={s.row}
        onPress={dragMode ? undefined : () => onOpen(item)}
        onLongPress={dragMode ? undefined : onLongPress}
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
        {unread > 0 && !dragMode ? (
          <View style={[s.badge, { backgroundColor: C.accentCoral }]}>
            <Text style={s.badgeText} allowFontScaling={false}>
              {unread > 9 ? '9+' : String(unread)}
            </Text>
          </View>
        ) : null}
        {dragMode ? (
          <View {...panHandlers} style={s.handle} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={s.handleText} allowFontScaling={false}>
              ≡
            </Text>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
});

export default function BotListScreen({ onOpen, onSettings, onExpression }) {
  const { C, T, S, R, scheme } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState([]);
  const [order, setOrder] = useState([]);
  const [unread, setUnread] = useState({});
  const [hidden, setHidden] = useState(() => new Set());
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const [dragMode, setDragMode] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [flash, setFlash] = useState(null);
  const [menuPrev, setMenuPrev] = useState({});
  const [groups, setGroups] = useState([]);
  const [unreadNote, setUnreadNote] = useState('');

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);
  const dragY = useRef(new Animated.Value(0)).current;
  const rowH = useRef(ROW_H); // onLayout 实测后覆盖
  const gapRef = useRef(S.x3);

  useEffect(() => {
    loadOrder().then(setOrder);
  }, []);

  const load = useCallback(async (isRefresh) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const full = await advisorsFull();
      const list = full.advisors;
      setGroups(normalizeGroups(full.groups));
      setUnreadNote(full.unreadNote || '');
      setRows(list);
      setErr(null);
      const m = {};
      list.forEach((it) => {
        m[String(it.id)] = Number(it.unread) || 0;
      });
      setUnread(m);
      // 服务端已隐藏 / 已标记删除的，进列表就不显示（恢复入口在「已隐藏」）
      setHidden(new Set(list.filter((it) => it.hidden || it.deleted).map((it) => String(it.id))));
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

  const visible = useMemo(() => rows.filter((it) => !hidden.has(String(it.id))), [rows, hidden]);
  const sorted = useMemo(() => applyOrder(visible, order), [visible, order]);
  const unreadTotal = useMemo(
    () => sorted.reduce((sum, it) => sum + (unread[String(it.id)] || 0), 0),
    [sorted, unread],
  );
  const groupsUnread = useMemo(() => groupsUnreadCount(groups), [groups]);
  // members / admin 都是 bot id，群组区要显示名字得先建一张 id -> name 表
  const names = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      m[String(r.id)] = r.name;
    });
    return m;
  }, [rows]);

  const reorder = useCallback(
    (fromIndex, dy) => {
      const stride = rowH.current + gapRef.current;
      const to = Math.max(0, Math.min(sorted.length - 1, fromIndex + Math.round(dy / stride)));
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
      botApi.read(String(bot.id)).catch(() => {}); // 失败不打断，下次 load 会拉回真值
      onOpen(bot);
    },
    [onOpen],
  );

  // 点进群：先进会话页（群消息走 GET /api/dsbot/group），未读同时清掉 —— 这条路现在真能读到消息了
  const openGroup = useCallback(
    (g) => {
      setGroups((prev) => prev.map((it) => (it.id === g.id ? { ...it, unread: 0, hasUnread: false } : it)));
      botApi.read(String(g.id)).catch(() => {});
      onOpen({ id: g.id, name: g.name, isGroup: true, memberCount: g.memberCount });
    },
    [onOpen],
  );

  const clearAll = useCallback(() => {
    botApi.readAll().catch(() => {});
    setGroups((prev) => prev.map((g) => ({ ...g, unread: 0, hasUnread: false })));
    setUnread((prev) => {
      const next = {};
      Object.keys(prev).forEach((k) => (next[k] = 0));
      return next;
    });
  }, []);

  const makePan = useCallback(
    (item, index) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true, // 只有把手挂着这个响应器
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => setDragId(String(item.id)),
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
    [dragY, reorder],
  );

  const renderItem = useCallback(
    ({ item, index }) => (
      <AdvisorRow
        item={item}
        unread={unread[String(item.id)] || 0}
        s={s}
        C={C}
        scheme={scheme}
        dragMode={dragMode}
        dragging={dragId === String(item.id)}
        onOpen={openBot}
        onLongPress={() => setMenuFor(item)}
        onMeasured={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0) rowH.current = h;
        }}
        panHandlers={makePan(item, index).panHandlers}
        translateY={dragY}
      />
    ),
    [s, C, scheme, unread, dragMode, dragId, openBot, makePan, dragY],
  );

  const keyExtractor = useCallback((it) => String(it.id), []);
  const getItemLayout = useCallback(
    (_, index) => {
      const stride = rowH.current + gapRef.current;
      return { length: stride, offset: stride * index, index };
    },
    [],
  );

  // 菜单：先改本地那一行，再发请求；失败回滚，错误原文交给顶部横幅（行内看不见）
  const patchRow = (id, patch) =>
    setRows((prev) => prev.map((r) => (String(r.id) === id ? { ...r, ...patch } : r)));

  const menuPatch = (patch) => {
    if (!menuFor) return;
    const id = String(menuFor.id);
    const prev = {};
    Object.keys(patch).forEach((k) => {
      prev[k] = menuFor[k];
    });
    setMenuPrev(prev);
    patchRow(id, patch);
    if (patch.hasUnread) setUnread((prev) => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
    // 隐藏 / 标记删除都要从主列表移走：真正过滤用的是 hidden 这个 Set
    if (patch.hidden || patch.deleted) {
      setHidden((s0) => {
        const n = new Set(s0);
        n.add(id);
        return n;
      });
    }
  };

  const menuFail = (message) => {
    if (menuFor) {
      const id = String(menuFor.id);
      patchRow(id, menuPrev);
      setHidden((s0) => {
        const n = new Set(s0);
        if ("hidden" in menuPrev) {
          if (menuPrev.hidden) n.add(id);
          else n.delete(id);
        }
        if ("deleted" in menuPrev) {
          if (menuPrev.deleted) n.add(id);
          else n.delete(id);
        }
        return n;
      });
    }
    setFlash(message);
  };

  const menuMove = (target) => {
    if (target) setDragId(String(target.id));
    setDragMode(true);
  };

  const stepLabel = { login: '登录失败', auth: '认证失败', list: '取顾问列表失败' };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {flash ? (
        <Pressable style={[s.flash, { top: insets.top + 8 }]} onPress={() => setFlash(null)}>
          <Text style={s.flashText} allowFontScaling={false}>
            {flash}
          </Text>
        </Pressable>
      ) : null}
      <View style={s.head}>
        <Text style={s.title} allowFontScaling={false}>
          顾问
        </Text>
        <View style={s.headRight}>
          {dragMode ? (
            <Pressable onPress={() => setDragMode(false)} hitSlop={10} style={s.clearBtn}>
              <Text style={s.clearText} allowFontScaling={false}>
                完成
              </Text>
            </Pressable>
          ) : unreadTotal + groupsUnread > 0 ? (
            <Pressable onPress={clearAll} hitSlop={10} style={s.clearBtn}>
              <Text style={s.clearText} allowFontScaling={false}>
                全部已读
              </Text>
            </Pressable>
          ) : null}
          {!dragMode ? (
            <>
              <Pressable onPress={onExpression} hitSlop={10}>
                <Text style={s.gear} allowFontScaling={false}>
                  表达
                </Text>
              </Pressable>
            <Pressable onPress={onSettings} hitSlop={10}>
              <Text style={s.gear} allowFontScaling={false}>
                设置
              </Text>
            </Pressable>
          </>
          ) : null}
        </View>
      </View>
      {unreadNote ? (
        <Text style={s.noteLine} allowFontScaling={false}>
          {unreadNote}
        </Text>
      ) : null}

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
          ListHeaderComponent={
            dragMode ? null : <GroupSection groups={groups} names={names} onOpen={openGroup} />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + S.x5 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.ink2} />
          }
          ListEmptyComponent={
            <View style={s.center}>
              <Text style={s.emptyTitle} allowFontScaling={false}>
                一个顾问都没有
              </Text>
            </View>
          }
        />
      )}

      {/* 长按菜单：RN 内置 Modal，不加依赖 */}
      <BotMenu
        bot={menuFor}
        onClose={() => setMenuFor(null)}
        onPatch={menuPatch}
        onFail={menuFail}
        onMove={menuMove}
      />
    </View>
  );
}

const makeStyles = (C, T, S, R) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    noteLine: { color: C.ink3, ...T.meta, paddingHorizontal: S.page, paddingBottom: S.x2 },
    flash: {
      position: 'absolute',
      left: S.page,
      right: S.page,
      backgroundColor: C.bad,
      borderRadius: R.capsule,
      paddingVertical: S.x3,
      paddingHorizontal: S.x4,
      zIndex: 20,
    },
    flashText: { color: C.onHero, ...T.meta },
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
    errBox: { margin: S.page, padding: S.card, backgroundColor: C.card, borderRadius: R.big, gap: S.x2 },
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
    rowWrap: { marginHorizontal: S.page, marginBottom: ROW_GAP },
    row: {
      height: ROW_H,
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
    handle: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
    handleText: { color: C.ink3, fontSize: 20, lineHeight: 24 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: C.card, borderTopLeftRadius: R.big, borderTopRightRadius: R.big, padding: S.x4, gap: S.x1 },
    sheetTitle: { color: C.ink2, ...T.meta, marginBottom: S.x2 },
    sheetItem: { paddingVertical: S.x3 },
    sheetText: { color: C.ink, ...T.title },
    sheetCancel: { marginTop: S.x2, borderTopWidth: 0 },
  });
