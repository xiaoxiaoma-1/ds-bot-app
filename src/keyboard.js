import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, Keyboard, Platform } from 'react-native';

// 键盘同步位移。
//
// 为什么不用 KeyboardAvoidingView：RN 0.86 的 KAV（Libraries/Components/Keyboard/
// KeyboardAvoidingView.js:154-180）位移是 await 测高 → setState(bottom) → LayoutAnimation，
// 起点晚一个异步测量，且曲线是 LayoutAnimation 的映射（iOS 键盘 curve 7 不在表里，会落到
// 'keyboard' 兜底）。这就是「先卡一下再动一下」的两段式。
//
// 这里直接听 keyboardWillChangeFrame（键盘动画开始前就发），把 duration / easing 原样喂给
// Animated.timing，位移放 transform → 原生驱动，与键盘同帧起步、同时长结束。

const EASING_BY_NAME = {
  easeIn: Easing.in(Easing.ease),
  easeInEaseOut: Easing.inOut(Easing.ease),
  easeOut: Easing.out(Easing.ease),
  linear: Easing.linear,
  // iOS 键盘曲线（UIViewAnimationCurve=7）无公开贝塞尔；这是常用近似，真机比对后可微调。
  keyboard: Easing.bezier(0.17, 0.59, 0.4, 0.94),
};

export function easingFor(name) {
  return EASING_BY_NAME[name] || EASING_BY_NAME.keyboard;
}

export function useKeyboardShift() {
  const shift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const run = (event, closing) => {
      let height = 0;
      if (!closing && event && event.endCoordinates) {
        const winHeight = Dimensions.get('window').height;
        height = Math.max(0, winHeight - event.endCoordinates.screenY);
      }
      const duration = Math.max(10, (event && event.duration) || 250);
      Animated.timing(shift, {
        toValue: height,
        duration,
        easing: easingFor(event && event.easing),
        useNativeDriver: true,
      }).start();
    };

    const subscriptions =
      Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillChangeFrame', (e) => run(e, false)),
            Keyboard.addListener('keyboardWillHide', (e) => run(e, true)),
          ]
        : [
            Keyboard.addListener('keyboardDidShow', (e) => run(e, false)),
            Keyboard.addListener('keyboardDidHide', (e) => run(e, true)),
          ];

    return () => subscriptions.forEach((s) => s && s.remove && s.remove());
  }, [shift]);

  return shift;
}

export function useKeyboardShiftJS() {
  const shift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const run = (event, closing) => {
      let height = 0;
      if (!closing && event && event.endCoordinates) {
        const winHeight = Dimensions.get('window').height;
        height = Math.max(0, winHeight - event.endCoordinates.screenY);
      }
      const duration = Math.max(10, (event && event.duration) || 250);
      Animated.timing(shift, {
        toValue: height,
        duration,
        easing: easingFor(event && event.easing),
        useNativeDriver: false,
      }).start();
    };

    const subscriptions =
      Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillChangeFrame', (e) => run(e, false)),
            Keyboard.addListener('keyboardWillHide', (e) => run(e, true)),
          ]
        : [
            Keyboard.addListener('keyboardDidShow', (e) => run(e, false)),
            Keyboard.addListener('keyboardDidHide', (e) => run(e, true)),
          ];

    return () => subscriptions.forEach((s) => s && s.remove && s.remove());
  }, [shift]);

  return shift;
}
