import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';

// 屏内还有「下一层」时的左滑返回（只给这种屏用：同一屏里用 state 切出了第二层）。
//
// 为什么需要它：导航栈里这一屏只有一层（观点库的「选一个入口」和「左右滑表态」是同一屏的两个 mode），
// 原生边缘手势一滑就是 pop 整页 —— 也就是跳过「表态」直接退回工作台主页，这是明令不许的。
// 所以进内层时把原生手势关掉（setOptions gestureEnabled:false），
// 再把「从左边缘往右滑」这件事接给页面自己的 goBack()，只退一层。
//
// 为什么挂在容器上而不是盖一条透明条：
//   盖条会吃掉卡片最边上那一窄条的手势（卡片在这屏里是全宽居中，窄屏上边距只有 11pt）。
//   挂在容器上用「冒泡阶段」判断：卡片自己先抢到 responder（它在 onStart 就抢），容器这边就不会被问到；
//   只有手指落在卡片以外的空白/边缘时容器才接管，卡片手势一点没被削弱。
//
// 只认 dx > 0（往右），和卡片「左滑不认同 / 右滑认同」的方向不打架；竖直优先的滑动一律不接，列表滚动照常。

const DIST = 42; // 至少滑这么远
const VX = 0.25; // 或者甩得够快

export default function useEdgeBack({ onBack, enabled = true, edgeWidth = 22 }) {
  // 回调放 ref：responder 不能因为父组件重渲染换标识，否则手势中途会被换掉
  const cb = useRef(onBack);
  cb.current = onBack;

  return useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (e, g) => {
          if (!enabled) return false;
          const x0 = typeof g.x0 === 'number' ? g.x0 : e.nativeEvent.locationX;
          if (typeof x0 === 'number' && x0 > edgeWidth) return false;
          return g.dx > 6 && g.dx > Math.abs(g.dy) * 1.2;
        },
        onMoveShouldSetPanResponderCapture: () => false, // 不抢子元素的手势
        onPanResponderRelease: (e, g) => {
          if (g.dx > DIST || g.vx > VX) {
            if (cb.current) cb.current();
          }
        },
      }),
    [enabled, edgeWidth],
  );
}
