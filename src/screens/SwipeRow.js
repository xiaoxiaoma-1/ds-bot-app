import { useMemo, useRef, useState } from 'react';
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

// 底下的红块尺寸（2026-11-15 定）：固定 64×64，贴着条目右端，不占正文。
// 以前是 width: SWIPE_W + height: '100%' —— 行一高（正文长）红块就跟着长成一块大门板，
// 行一矮（单行摘要）又被拉成 96 宽的长条，看着像「悬在右上角把字盖住」。
export const SWIPE_W = 84;
const DELETE_SIZE = 64;
const DELETE_INSET = 10;
const THRESHOLD_DX = 4;
const OPEN_AT = -56;

export default function SwipeRow({ children, onDelete, onSwipeState, deleteLabel = '删除', style }) {
  const { C, T, S, R } = useTheme();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);
  const tx = useRef(new Animated.Value(0)).current;
  const opened = useRef(false);
  // 红块是否挂在树上：拖动中 / 已滑开 才挂，静止不渲染
  const [showDel, setShowDel] = useState(false);

  const settle = (open) => {
    opened.current = open;
    // 收起时等动画播完再摘红块，否则红块会「啪」地消失
    if (open) setShowDel(true);
    else setTimeout(() => setShowDel(false), 200);
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
          // 手势判成横滑的那一刻就挂上红块并锁外层滚动
          setShowDel(true);
          if (onSwipeState) onSwipeState(true);
        },
      }),
    [onSwipeState, tx],
  );

  return (
    <View style={[s.clip, style]}>
      {/* 2026-11-15（老板截图：三个红块静止时就露在卡片上方）：
          以前红块一直挂着、靠卡片盖住；卡片没盖严就直接露出来。
          现在只在「拖动中」或「已滑开」时才挂，静止时根本不存在。 */}
      {showDel ? (
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
      ) : null}
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
    deleteLayer: {
      ...StyleSheet.absoluteFillObject,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingRight: DELETE_INSET,
    },
    // 红块：固定 64×64（圆角 8，通则 19），垂直居中贴右端；高度不再跟行高跑
    deleteBtn: {
      width: DELETE_SIZE,
      height: DELETE_SIZE,
      borderRadius: 8,
      backgroundColor: C.bad,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteText: { color: inkOn(C.bad), ...T.title },
  });
