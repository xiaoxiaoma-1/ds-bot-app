import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, Keyboard, Platform } from 'react-native';

// 键盘同步位移。
//
// 为什么不用 KeyboardAvoidingView：RN 0.86 的 KAV（Libraries/Components/Keyboard/
// KeyboardAvoidingView.js:154-180）虽然监听的是 keyboardWillShow/Hide，但它的位移是
//   await 测高 → setState(bottom) → LayoutAnimation.configureNext({... type: LayoutAnimation.Types[easing] || 'keyboard'})
// 也就是说：① 起点比键盘晚一个异步测量；② 走的是 LayoutAnimation 的曲线映射，不是键盘
// 自己那条 UIView 动画曲线（iOS 上是 curve 7，LayoutAnimation.Types 里没这个键，会落到 'keyboard' 兜底）。
// 结果就是老板看到的「先卡一下，再动一下」两段式。
//
// 这里的做法：直接听 keyboardWillChangeFrame（键盘动画开始前就会发出），把它给的
// duration / easing 原样喂给 Animated.timing，并把位移放在 transform 上 → 走原生驱动，
// 与键盘同一帧起步、同一时长结束。

const EASING_BY_NAME = {
  easeIn: Easing.in(Easing.ease),
  easeInEaseOut: Easing.inOut(Easing.ease),
  easeOut: Easing.out(Easing.ease),
  linear: Easing.linear,
  // iOS 键盘自家曲线（UIViewAnimationCurve = 7）没有公开贝塞尔；
  // 这条是社区常用的近似曲线，先按它走，真机比对后再微调（只允许调这一处）。
  keyboard: Easing.bezier(0.17, 0.59, 0.4, 0.94),
};

export function easingFor(name) {
  return EASING_BY_NAME[name] || EASING_BY_NAME.keyboard;
}

// 返回一个 0 → 键盘高度 的 Animated.Value；调用方把它取负作用在 transform 上。
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

    // iOS：will 系列，键盘自己动画之前就发；keyboardWillChangeFrame 在收起时 screenY 会落到屏幕外，
    // 算出来自然是 0，所以 show/hide 用同一个回调就够。
    // Android 没有 will 事件，退回 did（Android 键盘本身无动画，用 did 不会有两段式）。
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
