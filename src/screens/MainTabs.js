import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { usePressScale } from '../motion';
import { DOCK_INSET, IND_DOT, IND_H, IND_PILL, RADIUS, cellCenter, leftForCenter } from '../dockGeometry';
import BotListScreen from './BotListScreen';
import HomeScreen from './HomeScreen';
import SetupScreen from './SetupScreen';

// 底部 dock（定案）：黑胶囊、四项、选中标识「圆 → 胶囊 → 圆」形变滑动（老板 2026-11-13 定）。
// 页面切换：淡出淡入，**四页常驻 + 懒挂载**，用 opacity/pointerEvents 切，绝不 unmount。
//   · 懒挂载：某个 tab 第一次被点开才挂载，之后一直留着（启动时不会四页一起请求）
//   · active：只有当前页 active=true；非激活页收不到请求，也不会后台空转
// 动画结构（两段）：
//   t=0       圆：宽 44，中心在格 i
//   0→250ms   宽 44→88 + 中心移到格 j（spring tension 420 / friction 20，S3 档，带弹）
//   250→400ms 宽 88→44（timing 150ms，不带弹，否则到位会抖两下）
// 高度恒 44、borderRadius 恒 22 → 「圆」和「胶囊」两端都是半圆。
// width 不在 native driver 白名单，整屏只有这一个元素变宽，这一段走 JS driver；
// 位移放在同一段、同一个 driver 里，避免宽和位移不同步。
const PHASE1_MS = 250; // 拉宽 + 移动
const PHASE2_MS = 150; // 缩回圆
const PAGE_FADE_MS = 250; // 页面淡入淡出：盖过 dock 前 250ms，看起来是一件事
const PAGE_FADE_REDUCED_MS = 150; // 开了 Reduce Motion 也保留页面淡入淡出

const TABS = [
  { key: 'home', label: '首页' },
  { key: 'workbench', label: '工作台' },
  { key: 'advisors', label: '顾问' },
  { key: 'mine', label: '我的' },
];

function Placeholder({ name, C, T, S }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: S.x2 }}>
      <Text style={{ color: C.ink, ...T.title }} allowFontScaling={false}>
        {name}
      </Text>
      <Text style={{ color: C.ink3, ...T.meta }} allowFontScaling={false}>
        页面待接入
      </Text>
    </View>
  );
}

function DockItem({ tab, active, onPress, C, T }) {
  const press = usePressScale(0.94);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={s.item}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Animated.View style={press.scale}>
        <Text
          style={[s.label, { color: active ? C.hero : C.ink3 }, active ? T.body : null]}
          allowFontScaling={false}
          numberOfLines={1}
        >
          {tab.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export default function MainTabs({ navigation }) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();

  const [tab, setTab] = useState('advisors');
  // 懒挂载：只装已经点开过的页；顾问是初始页，一开始就装
  const [mounted, setMounted] = useState({ advisors: true });
  const [reduceMotion, setReduceMotion] = useState(false);

  const dockBottom = Math.max(insets.bottom, S.x2) + S.x2;
  const innerWidth = Math.max(0, winWidth - DOCK_INSET * 2);
  const count = TABS.length;

  // 每页一个不透明度值，常驻挂载、只切 opacity
  const opacities = useRef({});
  const getOpacity = useCallback((key) => {
    if (!opacities.current[key]) opacities.current[key] = new Animated.Value(key === 'advisors' ? 1 : 0);
    return opacities.current[key];
  }, []);

  // 指示器：宽 + left 两个值，同一段动画、同一个 JS driver
  const dotW = useRef(new Animated.Value(IND_DOT)).current;
  const dotLeft = useRef(
    new Animated.Value(leftForCenter(cellCenter(innerWidth, count, TABS.findIndex((t) => t.key === 'advisors')), IND_DOT)),
  ).current;
  const phase2Timer = useRef(null);
  const runToken = useRef(0); // 连点十次不飘：每次点击递增，旧 timer 一律作废

  // Reduce Motion：开了就全部瞬切（页面淡入淡出保留 150ms）
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduceMotion(Boolean(v));
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduceMotion(Boolean(v)));
    return () => {
      alive = false;
      if (sub && sub.remove) sub.remove();
    };
  }, []);

  useEffect(
    () => () => {
      if (phase2Timer.current) clearTimeout(phase2Timer.current);
    },
    [],
  );

  // 窗口宽度变了（旋转/分屏）：直接把指示器摆到当前格的圆态，不做动画
  useEffect(() => {
    const i = TABS.findIndex((t) => t.key === tab);
    if (i < 0) return;
    dotW.stopAnimation();
    dotLeft.stopAnimation();
    dotW.setValue(IND_DOT);
    dotLeft.setValue(leftForCenter(cellCenter(innerWidth, count, i), IND_DOT));
  }, [innerWidth, count]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveDot = useCallback(
    (toIndex) => {
      const token = ++runToken.current;
      if (phase2Timer.current) {
        clearTimeout(phase2Timer.current);
        phase2Timer.current = null;
      }
      dotW.stopAnimation();
      dotLeft.stopAnimation();

      const cx = cellCenter(innerWidth, count, toIndex);
      const pillLeft = leftForCenter(cx, IND_PILL);
      const dotLeftTarget = leftForCenter(cx, IND_DOT);

      if (reduceMotion) {
        dotW.setValue(IND_DOT);
        dotLeft.setValue(dotLeftTarget);
        return;
      }

      // 第一段：拉宽 + 移动，目标都是绝对值（不从上一格累加），中途再点也不飘
      Animated.parallel([
        Animated.spring(dotW, { toValue: IND_PILL, tension: 420, friction: 20, useNativeDriver: false }),
        Animated.spring(dotLeft, { toValue: pillLeft, tension: 420, friction: 20, useNativeDriver: false }),
      ]).start();

      // 第二段：250ms 到点收圆，不带弹
      phase2Timer.current = setTimeout(() => {
        if (token !== runToken.current) return; // 这中间又点了，作废
        Animated.parallel([
          Animated.timing(dotW, {
            toValue: IND_DOT,
            duration: PHASE2_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(dotLeft, {
            toValue: dotLeftTarget,
            duration: PHASE2_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: false,
          }),
        ]).start();
      }, PHASE1_MS);
    },
    [dotW, dotLeft, innerWidth, count, reduceMotion],
  );

  const switchTab = useCallback(
    (key) => {
      if (key === tab) return;
      const toIndex = TABS.findIndex((t) => t.key === key);
      if (toIndex < 0) return;

      // 第一次点开才挂载；之后一直留着
      setMounted((m) => (m[key] ? m : { ...m, [key]: true }));

      const inOp = getOpacity(key);
      const outOp = getOpacity(tab);
      inOp.setValue(0);
      Animated.timing(inOp, {
        toValue: 1,
        duration: reduceMotion ? PAGE_FADE_REDUCED_MS : PAGE_FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      Animated.timing(outOp, {
        toValue: 0,
        duration: reduceMotion ? PAGE_FADE_REDUCED_MS : PAGE_FADE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();

      moveDot(toIndex);
      setTab(key);
    },
    [tab, getOpacity, moveDot, reduceMotion],
  );

  const renderPage = useCallback(
    (key, active) => {
      if (key === 'home') {
        // 首页三块（看板 / 热点 / 接着写）各自独立加载，数据层在 src/homeData.js
        // onOpenDraft 等 DraftLibrary 路由接上再传
        return <HomeScreen active={active} />;
      }
      if (key === 'advisors') {
        return (
          <BotListScreen
            active={active}
            onOpen={(bot) => navigation.navigate(bot && bot.isGroup ? 'GroupChat' : 'Chat', { bot })}
            onSettings={() => switchTab('mine')}
          />
        );
      }
      if (key === 'mine') {
        // 设置页只在点「保存」时才发请求，没有常驻请求，不需要 active 门控
        return <SetupScreen onDone={() => switchTab('advisors')} />;
      }
      return <Placeholder name={key === 'home' ? '首页' : '工作台'} C={C} T={T} S={S} />;
    },
    [navigation, switchTab, C, T, S],
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, paddingBottom: IND_H + 20 + dockBottom }}>
        <View style={s.stack}>
          {TABS.map((t) =>
            mounted[t.key] ? (
              <Animated.View
                key={t.key}
                style={[s.layer, { opacity: getOpacity(t.key) }]}
                pointerEvents={t.key === tab ? 'auto' : 'none'}
              >
                {renderPage(t.key, t.key === tab)}
              </Animated.View>
            ) : null,
          )}
        </View>
      </View>

      <View
        style={[s.dock, { backgroundColor: C.hero, bottom: dockBottom, borderRadius: R.capsule }]}
        accessibilityRole="tablist"
      >
        <Animated.View
          pointerEvents="none"
          style={[
            s.indicator,
            { width: dotW, left: dotLeft, backgroundColor: C.card, borderRadius: RADIUS },
          ]}
        />
        <View style={s.items}>
          {TABS.map((t) => (
            <DockItem
              key={t.key}
              tab={t}
              active={t.key === tab}
              onPress={() => switchTab(t.key)}
              C={C}
              T={T}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  stack: { flex: 1 },
  // 四页常驻：全部绝对定位同位置叠着，只切 opacity / pointerEvents
  layer: { ...StyleSheet.absoluteFillObject },
  dock: {
    position: 'absolute',
    left: DOCK_INSET,
    right: DOCK_INSET,
    height: IND_H + 20, // 胶囊外还有上下各 10 的呼吸位
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 0,
  },
  indicator: { position: 'absolute', height: IND_H, top: 10 },
  items: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  item: { flex: 1, height: IND_H + 20, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15, lineHeight: 20, textAlign: 'center' },
});
