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
import { DeviceMotion } from 'expo-sensors';
import { avatarInk, inkOn, useTheme } from '../theme';
import { maskFor } from '../avatarMasks';
import CHARACTER_SHAPES from '../components/characterShapes';
import { applyOrder, loadOrder, saveOrder } from '../order';
import BotMenu from './botMenu';
import { botApi } from '../botApi';
import { advisorsFull } from '../api';
import { groupsUnreadCount, normalizeGroups } from '../groups';
import { setCached, useCachedResource } from '../cache';
import GroupSection from './GroupSection';

// Bot 列表：未读珊瑚橙胶囊、一键全部已读、长按弹菜单（移动/编辑/隐藏/删除）。
// 拖动入口只在菜单里选「移动」之后开启：此时每行右侧出现把手，拖完点右上「完成」退出。
// 行高不写魔数：ROW_H 与 ROW_GAP 只在样式常量里定义一次，拖动步长优先用 onLayout 实测值。

const ROW_H = 84;
const ROW_GAP = 12;
const LONG_PRESS_MS = 300;

// 圆润/有机形状可以加脸，几何类不加。
// 有脸 = characterShapes.js 里这个 shape 真带了 eyes 数据；不在表里的 shape 走 DEFAULT_EYES。
const FACED_SHAPES = new Set(
  Object.keys(CHARACTER_SHAPES).filter((k) => Array.isArray(CHARACTER_SHAPES[k].eyes) && CHARACTER_SHAPES[k].eyes.length),
);

// H1：「有一些它还没眼睛」—— 后端给的 shape 名不一定都在 characterShapes.js 里
// （比如 squircle / moon 这类旧名），那些头像就一颗眼睛都不画。给一套兜底眼睛。
// 100×100 坐标系，cx/cy 是中心，和源数据同一套口径。
const DEFAULT_EYES = [
  [44.5, 46, 7, 18, -8],
  [58.5, 42, 7, 18, -12],
];

// 眼睛颜色（H1）：以前是 inkOn(tint) —— 只有纯白 #FFFFFF 和近黑 #1A1A1A 两档，
// 结果深色脸上是一片白（「眼睛是白色的」），浅色脸上一点黑（「有一个是黑色的」）。
// 现在取脸色的同色系深/浅一档，任何脸型都能看出是「眼睛」，而且不刺眼。
function hexToRgb(h) {
  const s = String(h || '');
  if (!/^#[0-9a-f]{6}$/i.test(s)) return null;
  return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
}
function mixHex(a, b, t) {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  const out = ra.map((v, i) => Math.round(v + (rb[i] - v) * t));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}
function relLum(h) {
  const rgb = hexToRgb(h);
  if (!rgb) return 1;
  const lin = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
}

// 头像盒边长（眼睛坐标按这个换算）
const MARK = 40;
// 源数据是 100×100 坐标系、cx/cy 是眼睛**中心**、tilt 是角度。
// 以前这里把眼睛写成死像素（left:13.75 / right:13.75 / top:12）+ 一个自己发明的嘴，
// 那套值只对 gumdrop 一个形状成立：换 squircle / whale / moon 时眼睛直接落到轮廓外，
// 看起来就是「眼睛位置错、比例怪」，moon 这种窄形状还多出一条悬空的嘴。
// 现在一律按源数据逐个 shape 换算，并且不再画嘴（源设计里没有嘴）。
function eyeBox(shape, i) {
  const list = (CHARACTER_SHAPES[shape] && CHARACTER_SHAPES[shape].eyes) || DEFAULT_EYES;
  const e = (list && list[i]) || null;
  if (!e) return null;
  const [cx, cy, w, h, tilt] = e;
  const k = MARK / 100;
  return {
    left: (cx - w / 2) * k,
    top: (cy - h / 2) * k,
    width: w * k,
    height: h * k,
    borderRadius: (w * k) / 2,
    tilt,
  };
}


// 设备倾斜：只取 gamma / beta 两个角度，供头像眼睛跟随。
// 模拟器、没授权、或模块本身不可用时不抛错，静默退化成「眼睛不动」。
function useTilt() {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let alive = true;
    let sub = null;
    try {
      DeviceMotion.setUpdateInterval(80);
      sub = DeviceMotion.addListener(({ rotation }) => {
        if (!alive || !rotation) return;
        // rotation.gamma = 左右倾（-1..1 约），rotation.beta = 前后倾
        setTilt({ x: rotation.gamma || 0, y: rotation.beta || 0 });
      });
    } catch (e) {
      sub = null; // 拿不到传感器就当没这回事
    }
    return () => {
      alive = false;
      try {
        sub && sub.remove && sub.remove();
      } catch (e) {
        // 卸载时移除失败不影响其它逻辑
      }
    };
  }, []);

  return tilt;
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
  // 跟随 bot.avatar.color，与 DS Bot 桌面端 BotMark 一致（图形填色 + 透明底）
  const tint = avatar.color ? avatarInk(avatar.color, scheme) : C.ink2;
  // 眼睛 = 脸色的同色系深/浅一档（深色脸往 C.onHero 提亮，浅色脸往 C.ink 压深）
  const faceInk = relLum(tint) > 0.42 ? mixHex(tint, C.ink, 0.6) : mixHex(tint, C.onHero, 0.55);

  // 眼睛跟着倾斜走：单轴最多 3pt（老板要看得出来，又不至于飞出脸）；嘴不参与
  const tilt = useTilt();
  const maxShift = 3;
  const dx = Math.max(-maxShift, Math.min(maxShift, tilt.x * maxShift * 4));
  const dy = Math.max(-maxShift, Math.min(maxShift, tilt.y * maxShift * 4));
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
        <View style={s.markWrap}>
          <Animated.Image
            source={{ uri: maskFor(shape) }}
            style={[s.mark, { tintColor: tint }]}
            resizeMode="contain"
          />
          {/* 所有形状都画眼睛：有源数据的按源数据，没有的走 DEFAULT_EYES */}
          {(
            <>
              {[0, 1].map((i) => {
                const b = eyeBox(shape, i);
                if (!b) return null;
                return (
                  <View
                    key={'eye' + i}
                    style={[
                      s.eye,
                      {
                        left: b.left,
                        top: b.top,
                        width: b.width,
                        height: b.height,
                        borderRadius: b.borderRadius,
                        backgroundColor: faceInk,
                        transform: [{ translateX: dx }, { translateY: dy }, { rotate: `${b.tilt}deg` }],
                      },
                    ]}
                  />
                );
              })}
            </>
          )}
        </View>
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

// 切回顾问页时的静默刷新：1.5 秒内来回切不重复发（未读数会变，但不值得为此连发）
const SILENT_REFRESH_MIN_MS = 1500;

export default function BotListScreen({ onOpen, onSettings, navigation, active = true }) {
  const { C, T, S, R, scheme } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState([]);
  const [order, setOrder] = useState([]);
  const [unread, setUnread] = useState({});
  const [hidden, setHidden] = useState(() => new Set());
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false); // 只首次激活时拉一次，避免每次切回来都请求
  const lastFetchRef = useRef(0); // 上次拉取时间戳，静默刷新的防抖依据
  const [refreshing, setRefreshing] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const [dragMode, setDragMode] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [flash, setFlash] = useState(null);
  const [menuPrev, setMenuPrev] = useState({});
  const [groups, setGroups] = useState([]);
  const [unreadNote, setUnreadNote] = useState('');

  // 列表首次加载走缓存：有缓存先显示上次的列表，后台静默刷新（key 固定 'advisors'）
  const cachedAdvisors = useCachedResource('advisors', advisorsFull);

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

  // 拿到 advisorsFull 之后的落库动作：首次加载和静默刷新必须走同一段，避免两套逻辑走偏
  const applyFull = (full) => {
    const list = full.advisors;
    setCached('advisors', full); // 三个入口（首次 / 静默 / 手动）都在这里落缓存
    setGroups(normalizeGroups(full.groups));
    setUnreadNote(full.unreadNote || '');
    setRows(list);
    const m = {};
    list.forEach((it) => {
      m[String(it.id)] = Number(it.unread) || 0;
    });
    setUnread(m);
    // 服务端已隐藏 / 已标记删除的，进列表就不显示（恢复入口在「已隐藏」）
    setHidden(new Set(list.filter((it) => it.hidden || it.deleted).map((it) => String(it.id))));
  };

  // 缓存命中或后台静默刷新回来了：落到列表状态（列表/输入相关 UI 一律不动）
  useEffect(() => {
    if (cachedAdvisors.data) applyFull(cachedAdvisors.data);
  }, [cachedAdvisors.data]);

  const load = useCallback(async (isRefresh) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const full = await advisorsFull();
      applyFull(full);
      setErr(null);
    } catch (e) {
      // 有缓存时保留旧列表，错误只在完全没有缓存时占整屏
      setErr({ step: e.step || 'list', message: e.message || '未知错误' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 静默刷新：不显示 loading、不动现有列表、失败当没发生（切回来看到旧列表，好过看到一个红字报错）
  const refreshQuiet = useCallback(async () => {
    try {
      const full = await advisorsFull();
      applyFull(full);
    } catch (e) {
      // 故意吞掉
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    if (!loadedRef.current) {
      // 首次激活：首次拉取交给 useCachedResource（有缓存就不转圈），这里只打标记
      loadedRef.current = true;
      lastFetchRef.current = Date.now();
      return;
    }
    // 之后再激活：静默刷（未读数会变），1.5 秒内来回切不重复发
    const now = Date.now();
    if (now - lastFetchRef.current < SILENT_REFRESH_MIN_MS) return;
    lastFetchRef.current = now;
    refreshQuiet();
  }, [active, load, refreshQuiet]);

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

  // 有缓存就保留列表、只提示一行小字；没有缓存才占整屏转圈 / 错误态
  const hasCache = cachedAdvisors.data != null;
  const fetchErr = err || (cachedAdvisors.error ? { step: 'list', message: cachedAdvisors.error } : null);
  const showSpinner = !hasCache && (cachedAdvisors.loading || loading);

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
            <Pressable onPress={onSettings} hitSlop={10}>
              <Text style={s.gear} allowFontScaling={false}>
                设置
              </Text>
            </Pressable>
          ) : null}
          {!dragMode ? (
            <Pressable onPress={() => navigation.navigate('TeamManage')} hitSlop={10}>
              <Text style={s.gear} allowFontScaling={false}>
                管理
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {unreadNote ? (
        <Text style={s.noteLine} allowFontScaling={false}>
          {unreadNote}
        </Text>
      ) : null}
      {fetchErr && hasCache ? (
        <Text style={s.noteLine} allowFontScaling={false}>
          {stepLabel[fetchErr.step] || '刷新失败'}，显示的是上次内容
        </Text>
      ) : null}

      {showSpinner ? (
        <View style={s.center}>
          <ActivityIndicator color={C.accent} />
          <Text style={s.centerText} allowFontScaling={false}>
            正在取顾问列表
          </Text>
        </View>
      ) : !hasCache && fetchErr ? (
        <View style={s.errBox}>
          <Text style={s.errTitle} allowFontScaling={false}>
            {stepLabel[fetchErr.step] || '出错了'}
          </Text>
          <Text style={s.errMsg} allowFontScaling={false}>
            {fetchErr.message}
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
    mark: { width: MARK, height: MARK },
    markWrap: {
      width: MARK,
      height: MARK,
      position: 'relative',
    },
    // 位置/尺寸全部由 eyeBox() 按 shape 的源数据算，这里只留 position 与公共兜底值
    eye: { position: 'absolute', width: 2.5, height: 6.5, borderRadius: 1.2 },
    rowBody: { flex: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: S.x1, marginTop: S.x1 },
    dot: { width: 6, height: 6, borderRadius: R.capsule },
    status: { color: C.ink2, ...T.meta, flexShrink: 1 },
    name: { color: C.ink, ...T.title },
    badge: {
      minWidth: 20,
      height: 20,
      borderRadius: R.capsule,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: C.onAccent, fontSize: 11, lineHeight: 15, fontWeight: '600' },
    handle: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
    handleText: { color: C.ink3, ...T.title },
    backdrop: { flex: 1, backgroundColor: C.scrim, justifyContent: 'flex-end' },
    sheet: { backgroundColor: C.card, borderTopLeftRadius: R.big, borderTopRightRadius: R.big, padding: S.x4, gap: S.x1 },
    sheetTitle: { color: C.ink2, ...T.meta, marginBottom: S.x2 },
    sheetItem: { paddingVertical: S.x3 },
    sheetText: { color: C.ink, ...T.title },
    sheetCancel: { marginTop: S.x2, borderTopWidth: 0 },
  });
