import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ThemeProvider, useTheme } from './src/theme';
import { isConfigured } from './src/store';
import SetupScreen from './src/screens/SetupScreen';
import MainTabs from './src/screens/MainTabs';
import ChatScreen from './src/screens/ChatScreen';
import GroupChatScreen from './src/screens/GroupChatScreen';
import ExpressionScreen from './src/screens/ExpressionScreen';

// 导航：原生栈（react-native-screens）。
//   边缘左滑返回靠 gestureEnabled + fullScreenGestureEnabled:false —— 只接管屏幕左边缘 20~30pt，
//   中间区域的横向手势留给页内内容（观点库将来做左右滑不会和返回打架）。
// 深浅色：导航容器自身主题也跟随，避免转场时闪系统默认白底。

const Stack = createNativeStackNavigator();

function navThemeFor(scheme, C) {
  const base = scheme === 'light' ? DefaultTheme : DarkTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      background: C.bg,
      card: C.bg,
      text: C.ink,
      border: 'transparent',
      primary: C.accent,
    },
  };
}

export default function App() {
  const scheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <ThemeProvider scheme={scheme}>
        <NavRoot scheme={scheme} />
      </ThemeProvider>
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
    </SafeAreaProvider>
  );
}

function NavRoot({ scheme }) {
  const { C, S } = useTheme();
  const theme = useMemo(() => navThemeFor(scheme, C), [scheme, C]);

  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator
        initialRouteName="Boot"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          gestureEnabled: true,
          fullScreenGestureEnabled: false,
          fullScreenGestureShadowEnabled: false,
          contentStyle: { backgroundColor: C.bg },
        }}
      >
        <Stack.Screen name="Boot" component={BootScreen} options={{ animation: 'none' }} />
        <Stack.Screen name="Setup" component={SetupRoute} />
        <Stack.Screen name="BotList" component={BotListRoute} />
        <Stack.Screen name="Chat" component={ChatRoute} />
        <Stack.Screen name="GroupChat" component={GroupChatRoute} />
        <Stack.Screen name="Expression" component={ExpressionRoute} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function BootScreen({ navigation }) {
  const { C, T, S } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S), [C, T, S]);
  const [checked, setChecked] = useState(false);

  const boot = useCallback(async () => {
    const ok = await isConfigured();
    navigation.replace(ok ? 'BotList' : 'Setup');
    setChecked(true);
  }, [navigation]);

  useEffect(() => {
    boot();
  }, [boot]);

  return (
    <View style={s.boot}>
      <ActivityIndicator color={C.accent} />
      {checked ? null : (
        <Text style={s.bootText} allowFontScaling={false}>
          正在读取本机设置
        </Text>
      )}
    </View>
  );
}

function SetupRoute({ navigation }) {
  // 同一屏两用：首次启动时是登录页（无返回），从列表点「设置」进来时是设置页（必须有返回）。
  // 判断依据就是栈里有没有上一层 —— canGoBack()。
  const canGoBack = navigation.canGoBack();
  return (
    <SetupScreen
      onBack={canGoBack ? () => navigation.goBack() : undefined}
      onDone={() => {
        if (navigation.canGoBack()) navigation.goBack();
        else navigation.replace('BotList');
      }}
    />
  );
}

function BotListRoute({ navigation }) {
  return (
    <BotListScreen
      onOpen={(bot) => {
        navigation.navigate(bot && bot.isGroup ? 'GroupChat' : 'Chat', { bot });
      }}
      onSettings={() => navigation.navigate('Setup')}
      onExpression={() => navigation.navigate('Expression')}
    />
  );
}

function ChatRoute({ route, navigation }) {
  const bot = route.params?.bot;
  // iOS 的键盘是系统级动画，页面转场一开始就 dismiss 是能拿到的最早时机；
  // 系统仍可能让它比页面慢一拍（见交付说明）。
  useEffect(() => {
    const offStart = navigation.addListener('transitionStart', (e) => {
      if (e && e.data && e.data.closing) Keyboard.dismiss();
    });
    const offRemove = navigation.addListener('beforeRemove', () => Keyboard.dismiss());
    return () => {
      offStart && offStart();
      offRemove && offRemove();
    };
  }, [navigation]);
  const { C, T, S } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S), [C, T, S]);
  if (!bot || !bot.id) {
    return (
      <View style={s.boot}>
        <Text style={s.bootText} allowFontScaling={false}>
          会话参数丢了，正在返回
        </Text>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={[s.bootText, { color: C.accent }]} allowFontScaling={false}>
            返回
          </Text>
        </Pressable>
      </View>
    );
  }
  return <ChatScreen bot={bot} onBack={() => navigation.goBack()} />;
}

function ExpressionRoute({ navigation }) {
  return <ExpressionScreen onBack={() => navigation.goBack()} />;
}

function GroupChatRoute({ route, navigation }) {
  const group = route.params?.bot;
  const { C, T, S } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S), [C, T, S]);
  if (!group || !group.id) {
    return (
      <View style={s.boot}>
        <Text style={s.bootText} allowFontScaling={false}>
          群参数丢了，正在返回
        </Text>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={[s.bootText, { color: C.accent }]} allowFontScaling={false}>
            返回
          </Text>
        </Pressable>
      </View>
    );
  }
  return <GroupChatScreen group={group} onBack={() => navigation.goBack()} />;
}

const makeStyles = (C, T, S) =>
  StyleSheet.create({
    boot: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: S.x3 },
    bootText: { color: C.ink2, ...T.meta },
  });
