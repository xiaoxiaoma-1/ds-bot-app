import { useMemo, useRef } from 'react';
import { Animated, Dimensions, PanResponder } from 'react-native';

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

// 2026-11-15（老板要 A 方案：整页跟手，不是一次性触发）：
//   手指在屏幕最左边那一窄条往右拖 → 整屏跟着手走（x 就是那个位移）；
//   中途往左滑 → x 跟着回 0，手不离屏可以来回；
//   松手时超过屏宽 1/3 或甩得够快 → 补一段动画推到屏宽，再回调 onBack；
//   否则弹簧回 0。
// 屏宽必须用 Dimensions 取：responder 的 e.nativeEvent 里**没有 layout 字段**（那是 onLayout 才给的），
// 以前写成 e.nativeEvent.layout || {width:393} 等于所有机型都按 393 算。
const SW = Dimensions.get('window').width;
const TRIGGER_VX = 0.3; // 甩得够快也算，改 0.3 更容易触发（贴近 iOS）
const SPRING = { tension: 420, friction: 20, useNativeDriver: false }; // 与卡片同一套弹簧令牌；pan 是 JS 驱动，弹簧必须同为 JS

export default function useEdgeBack({ onBack, enabled = true, edgeWidth = 22 }) {
  // 回调放 ref：responder 不能因为父组件重渲染换标识，否则手势中途会被换掉
  const cb = useRef(onBack);
  cb.current = onBack;
  
  // 跟手平移值
  const x = useRef(new Animated.Value(0)).current;

  return useMemo(
    () => ({
      x,
      panHandlers: PanResponder.create({
        // 2026-11-15（老板第三次反馈「还是不跟手」）：必须改到捕获阶段抢。
        // 卡片的 responder 也是 capture 阶段抢的（ViewsPoolScreen.js:173），谁先返 true 谁赢；
        // RN 同阶段按树序（根→叶），我们是卡片的祖先，所以我们的 move capture 先被问，返 true 就赢。
        // 冒泡阶段永远轮不到 —— 这就是前两版一直没效果的根因。
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,   // 起手不抢，留给竖滑滚屏
        onMoveShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (e, g) => {
          if (!enabled) return false;
          const x0 = typeof g.x0 === 'number' ? g.x0 : e.nativeEvent.locationX;
          return typeof x0 === 'number' && x0 <= edgeWidth && g.dx > 4 && g.dx > Math.abs(g.dy) * 1.2;
        },
        onPanResponderMove: (e, g) => {
          // 只往右推，往左不推（松手时往左弹），手不离屏可来回
          x.setValue(Math.max(0, g.dx));
        },
        onPanResponderRelease: (e, g) => {
          const w = SW || 393;
          if (g.dx > w / 3 || g.vx > TRIGGER_VX) {
            // 触发返回：补完剩下的位移再回调（页面已经跟着手走了一部分，不许跳）
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
      }),
    }),
    [enabled, edgeWidth, x],
  );
}
