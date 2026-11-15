import { useMemo, useRef } from 'react';
import { Animated, Dimensions, PanResponder } from 'react-native';

// 屏幕左边缘「右滑返回」的手势层（2026-11-15 第四版，改成窄条抢 touch-start）
//
// ── 为什么前几版都失败 ──────────────────────────────
// 前几版把 PanResponder 挂在整页容器（Animated.View）上，靠
//   onMoveShouldSetPanResponder / onMoveShouldSetPanResponderCapture
// 在**移动阶段**去抢 responder。
//
// 但卡片自己的 responder 是这么写的（ViewsPoolScreen.js）：
//   onStartShouldSetPanResponder: () => !verdict      ← 触摸**开始**就抢
//   onStartShouldSetPanResponderCapture: () => !verdict
// 也就是开关在 touch-start 那一瞬就已经定了：卡片先成为 responder。
// 之后移动阶段的 capture 协商在真机上并不可靠，所以边缘手势一直拿不到。
//
// ── 这一版的做法 ───────────────────────────────
// 不再跟卡片抢同一个 touch。在屏幕最左边铺一条**独立的窄条 View**（宽度=edgeWidth），
// 它是卡片之后的兄弟节点、绝对定位、画在最上层：
//   · 手指落在窄条上 → 命中测试先命中窄条，卡片**根本不在命中路径里**，无从抢起
//   · 窄条 touch-start 就拿到 responder
//   · 拿不到时才轮到卡片 —— 两条手势彻底不打架
//
// ── 代价 ────────────────────────────────────
// 窄条会盖住卡片最左边 edgeWidth 那么多像素。卡片宽 353、屏宽约 393，
// 两侧各留 20，所以 edgeWidth=28 只吃到卡片 8px —— 没人会从卡片最外 8px 开始拖。
//
// ── 行为 ────────────────────────────────────
//   · 按住往右拖 → 整页 1:1 跟手（x = dx，只往右）
//   · 手不离屏往左滑 → x 跟着回 0，可以来回
//   · 松手时超过屏宽 1/3 或甩得够快 → 补动画推到屏宽，再回调 onBack
//   · 否则弹簧回 0

const SW = Dimensions.get('window').width;
const TRIGGER_VX = 0.3;
const SPRING = { tension: 420, friction: 20, useNativeDriver: false };

export default function useEdgeBack({ onBack, enabled = true, edgeWidth = 28 }) {
  const cb = useRef(onBack);
  cb.current = onBack;

  const x = useRef(new Animated.Value(0)).current;

  return useMemo(
    () => ({
      x,
      panHandlers: PanResponder.create({
        // 窄条是独立命中区：touch-start 直接接管，不和卡片协商
        onStartShouldSetPanResponder: () => Boolean(enabled),
        onStartShouldSetPanResponderCapture: () => Boolean(enabled),
        onMoveShouldSetPanResponder: () => Boolean(enabled),
        onMoveShouldSetPanResponderCapture: () => Boolean(enabled),

        onPanResponderGrant: () => {
          // 手指按下先停掉还在跑的动画，避免和弹簧抢 x
          x.stopAnimation();
        },
        onPanResponderMove: (e, g) => {
          // 1:1 跟手；只往右推，往左不推（松手时往左弹回 0）
          x.setValue(Math.max(0, g.dx));
        },
        onPanResponderRelease: (e, g) => {
          const w = SW || 393;
          if (g.dx > w / 3 || g.vx > TRIGGER_VX) {
            Animated.timing(x, {
              toValue: w,
              duration: 220,
              useNativeDriver: false,
            }).start(() => {
              if (cb.current) cb.current();
            });
          } else {
            Animated.spring(x, { toValue: 0, ...SPRING }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(x, { toValue: 0, ...SPRING }).start();
        },
        // 有人想抢：不让，这条手势归我们
        onPanResponderTerminationRequest: () => false,
      }),
      edgeWidth,
    }),
    [enabled, edgeWidth, x],
  );
}
