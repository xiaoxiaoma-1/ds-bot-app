import { useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { usePressScale } from '../motion';
import BotListScreen from './BotListScreen';
import SetupScreen from './SetupScreen';

// 底部 dock（定案）：黑胶囊、四项、选中项白圆凸出 4。
// 分工：本文件只管「渲染哪一屏 + dock」，不持有页面内容。
// 首页/工作台的真实页面由工作台工程师放在 src/screens/workbench/ 下，
// 他交付后把下面的 Placeholder 换成他的组件即可，App.js 里的路由名不变。

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
    <Pressable onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={s.item}>
      <Animated.View style={press.scale}>
        {active ? (
          <View style={[s.circle, { backgroundColor: C.card }]}>
            <Text style={[s.circleText, { color: C.hero }]} allowFontScaling={false}>
              {tab.label.slice(0, 1)}
            </Text>
          </View>
        ) : (
          <Text style={[s.label, { color: C.ink3 }, T.meta]} allowFontScaling={false}>
            {tab.label}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

export default function MainTabs({ navigation }) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('advisors');
  const dockBottom = Math.max(insets.bottom, S.x2) + S.x2;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, paddingBottom: 64 + dockBottom }}>
        {tab === 'advisors' ? (
          <BotListScreen
            onOpen={(bot) => navigation.navigate(bot && bot.isGroup ? 'GroupChat' : 'Chat', { bot })}
            onSettings={() => setTab('mine')}
          />
        ) : tab === 'mine' ? (
          <SetupScreen onDone={() => setTab('advisors')} />
        ) : (
          <Placeholder name={tab === 'home' ? '首页' : '工作台'} C={C} T={T} S={S} />
        )}
      </View>

      <View
        style={[
          s.dock,
          { backgroundColor: C.hero, bottom: dockBottom, borderRadius: R.capsule },
        ]}
      >
        {TABS.map((t) => (
          <DockItem
            key={t.key}
            tab={t}
            active={t.key === tab}
            onPress={() => setTab(t.key)}
            C={C}
            T={T}
          />
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 20,
    right: 20,
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
  },
  item: { flex: 1, height: 64, alignItems: 'center', justifyContent: 'center' },
  label: { textAlign: 'center' },
  // 选中态：白圆 d=44，上移 4pt 凸出胶囊
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginTop: -4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleText: { fontSize: 17, fontWeight: '600' },
});
