import { useCallback, useEffect, useRef } from 'react';
import { Animated } from 'react-native';

// 动效令牌（design/动效规范.md）：三档弹簧，只允许这三组，friction 可 ±2。
// S1 硬（按下） 400/35；S2 柔（松手/错开） 300/26；S3 弹（气泡/新消息） 420/20。
// 全部 useNativeDriver: true（只动 transform / opacity）；循环动画不用弹簧。
export const SPRING = {
  S1: { tension: 400, friction: 35, useNativeDriver: true },
  S2: { tension: 300, friction: 26, useNativeDriver: true },
  S3: { tension: 420, friction: 20, useNativeDriver: true },
};

export const DURATION_MAX = 400;

// 按压反馈：按下 S1，松手 S2
export function usePressScale(scaleTo = 0.96) {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = useCallback(() => {
    Animated.spring(scale, { toValue: scaleTo, ...SPRING.S1 }).start();
  }, [scale, scaleTo]);
  const onPressOut = useCallback(() => {
    Animated.spring(scale, { toValue: 1, ...SPRING.S2 }).start();
  }, [scale]);
  return { scale, onPressIn, onPressOut };
}

// 气泡/卡片入场：S3 scale 0.92→1 + opacity，只播一次
export function useAppearOnce(delay = 0) {
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const played = useRef(false);

  useEffect(() => {
    if (played.current) return;
    played.current = true;
    const run = () =>
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, ...SPRING.S3 }),
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
    if (delay > 0) {
      const t = setTimeout(run, delay);
      return () => clearTimeout(t);
    }
    run();
  }, [scale, opacity, delay]);

  return { style: { transform: [{ scale }], opacity } };
}

// 新消息轻跳一次：translateY 0→-4→0
export function useBounceOnce() {
  const y = useRef(new Animated.Value(0)).current;
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    Animated.sequence([
      Animated.spring(y, { toValue: -4, ...SPRING.S3 }),
      Animated.spring(y, { toValue: 0, ...SPRING.S2 }),
    ]).start();
  }, [y]);
  return { transform: [{ translateY: y }] };
}

// 首屏错开：30ms × 行序，最多 6 行；didStagger 记一次，滚动/重渲染不再触发
export function useStagger(maxRows = 6, step = 30) {
  const did = useRef(false);
  const delayFor = useCallback(
    (index) => (index >= maxRows ? -1 : index * step),
    [maxRows, step],
  );
  const claim = useCallback(() => {
    if (did.current) return false;
    did.current = true;
    return true;
  }, []);
  return { delayFor, claim, didStagger: did };
}
