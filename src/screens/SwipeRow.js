import { useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, inkOn } from '../theme';
import { useRoles } from './workbench/roles';

// 左滑露出「删除」的行（2026-11-14）
//
// 为什么抽出来：这段逻辑之前在「能力表达」的历史行、「我的观点」的卡片里各写了一遍，
// 三处各写一次的结果就是宽度写死三遍（96 / clamp / toValue），任一处不一致红块和卡片之间就出缝。
// 现在只有 SWIPE_W 一个数，宽度、clamp、toValue 全部引用它。
//
// 两个真问题（F2/F3）：
//   ① 红块靠父容器 overflow:hidden 裁圆角 —— iOS 上父容器里装的是会被 transform 平移的子元素时
//      这种裁剪不可靠，红块按自己的尺寸画出去，于是红块比卡片高、圆角更圆、中间留缝。
//      改法：红块自带 borderRadius + height:'100%'；外面再包一层**普通 View** 裁圆角，
//      裁剪作用在普通 View 上，不作用在平移元素上。
//   ② 判定阈值 8pt 太晚 —— 横滑的头一小段已经被外层 ScrollView 的原生手势接走、判成纵向滚动，
//      所以「左滑不跟手、页面还能上下滚」。阈值降到 4，并在判定成立瞬间把外层滚动关掉。
//
// props
//   children     卡片内容
//   onDelete()   点「删除」
//   onSwipeState(open:boolean)  可选：滑开/收起时通知外层（外层可用它锁 ScrollView）
//   deleteLabel  默认「删除」

export const SWIPE_W = 96;
const THRESHOLD_DX = 4;
const OPEN_AT = -56;

export default function SwipeRow({ children, onDelete, onSwipeState, deleteLabel = '删除', style }) {
  const { C, T, S, R } = useTheme();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);
  const tx = useRef(new Animated.Value(0)).current;
  const opened = useRef(false);

  const settle = (open) => {
    opened.current = open;
    if (onSwipeState) onSwipeState(open);
    Animated.spring(tx, {
      toValue: open ? -SWIPE_W : 0,
      useNativeDriver: true,
      tension: 420,
      friction: 20,
    }).start();
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        // 阈值 4（原来是 8）：等 8pt 时外层已经把它当纵向滚动了
        onMoveShouldSetPanResponder: (e, g) => Math.abs(g.dx) > THRESHOLD_DX && Math.abs(g.dx) > Math.abs(g.dy),
        onMoveShouldSetPanResponderCapture: (e, g) => Math.abs(g.dx) > THRESHOLD_DX && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (e, g) => {
          // 已经滑开的行，右滑是「收回去」；没收开的行只允许往左滑
          const base = opened.current ? -SWIPE_W : 0;
          const next = Math.min(0, Math.max(-SWIPE_W, base + g.dx));
          tx.setValue(next);
        },
        onPanResponderRelease: (e, g) => {
          const base = opened.current ? -SWIPE_W : 0;
          const end = base + g.dx;
          settle(end < OPEN_AT);
        },
        onPanResponderTerminate: () => settle(opened.current),
        onPanResponderGrant: () => {
          // 手势判成横滑的那一刻就锁外层滚动，不再跟纵向滚动抢
          if (onSwipeState) onSwipeState(true);
        },
      }),
    [onSwipeState, tx],
  );

  return (
    <View style={[s.clip, style]}>
      <View style={s.deleteLayer} pointerEvents="box-none">
        <Pressable
          style={s.deleteBtn}
          onPress={() => {
            settle(false);
            if (onDelete) onDelete();
          }}
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
        >
          <Text style={s.deleteText} allowFontScaling={false}>{deleteLabel}</Text>
        </Pressable>
      </View>
      <Animated.View {...responder.panHandlers} style={{ transform: [{ translateX: tx }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

const makeStyles = (C, T, S, R, K) =>
  StyleSheet.create({
    // 普通 View 裁圆角（不是裁剪平移元素本身）
    clip: { borderRadius: R.small, overflow: 'hidden' },
    deleteLayer: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', justifyContent: 'flex-end' },
    // 红块：自己带圆角 + 100% 高，不再依赖父容器裁
    deleteBtn: {
      width: SWIPE_W,
      height: '100%',
      borderRadius: R.small,
      backgroundColor: C.bad,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteText: { color: inkOn(C.bad), ...T.title },
  });
