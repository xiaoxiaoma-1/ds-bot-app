import { useTheme } from '../../theme';
import { useRoles } from './roles';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// 底部 dock（令牌 H20/H21）：黑胶囊 353×64，四项等宽，选中项白圆 d=44 凸出 4。
// 八块工作台页面共用这一份，别每页抄一份。
//
// 悬浮不占流 —— 页面内容底部必须用 dockPadding() 让位，
// 否则滚到底时最后一张卡会被 dock 压住，点不到底边（2026-11-12 定，首页已踩过）。

export const DOCK_H = 64; // 令牌 H20
export const DOCK_CIRCLE = 44; // 令牌 H21 选中圆
// 圆心高出 dock 顶 4，所以圆上缘在 dock 顶上方 26。底部让位必须把这 26 一起留出来：
// 少留这 26，滚到底时最后一行被白圆压住，白圆还会吞掉那一块的点击（2026-11-12 稿库预览暴露）。
export const DOCK_LIFT = DOCK_CIRCLE / 2 - 4; // 26

// 页面内容底部统一用这个数，不要自己写 insets.bottom + 8 + 64
export function dockPadding(insets, S) {
  return insets.bottom + S.x2 + DOCK_H + DOCK_LIFT;
}

export const DOCK_TABS = [
  { key: 'home', label: '首页' },
  { key: 'workbench', label: '工作台' },
  { key: 'advisor', label: '顾问' },
  { key: 'me', label: '我的' },
];

export default function Dock({ activeTab = 'workbench', onTabPress }) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = makeStyles(C, T, S, R, K);

  return (
    <View style={[s.dock, { bottom: insets.bottom + S.x2 }]}>
      {DOCK_TABS.map((t) => {
        const on = t.key === activeTab;
        return (
          <Pressable
            key={t.key}
            style={s.item}
            onPress={() => onTabPress && onTabPress(t.key)}
            accessibilityRole="button"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
          >
            {on ? <View style={s.circle} /> : null}
            <Text
              style={[s.label, { color: on ? K.dockOn : K.dockIdle, opacity: on ? 1 : K.dockIdleOpacity }]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (C, T, S, R, K) =>
  StyleSheet.create({
    dock: {
      position: 'absolute',
      left: S.page,
      right: S.page,
      height: DOCK_H,
      borderRadius: R.big,
      backgroundColor: K.dock,
      flexDirection: 'row',
      alignItems: 'stretch',
    },
    item: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: S.x2 },
    circle: {
      position: 'absolute',
      top: -26, // H21：圆心 y=742、dock 顶 746 → 圆心高出 4，圆上缘 −26
      left: '50%',
      marginLeft: -DOCK_CIRCLE / 2,
      width: DOCK_CIRCLE,
      height: DOCK_CIRCLE,
      borderRadius: R.capsule,
      backgroundColor: K.circle,
    },
    label: { ...T.meta },
  });
