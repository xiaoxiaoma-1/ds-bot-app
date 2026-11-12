import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ThemeProvider, useTheme } from './src/theme';
import { isConfigured } from './src/store';
import SetupScreen from './src/screens/SetupScreen';
import BotListScreen from './src/screens/BotListScreen';
import ChatScreen from './src/screens/ChatScreen';

// 导航：原生栈（react-native-screens），不是 JS 假动画。
// 三个页面挂在同一个 Stack 上，靠手势/返回按钮出栈，iOS 的左边缘返回因此是系统原生行为。
//
// 手势口径（给未来「观点库左右滑」留位置）：
//   gestureEnabled: true            —— 左边缘起手可返回
//   fullScreenGestureEnabled: false —— 只要边缘那 20~30pt，不抢全屏手势
//   这样「左边缘起手 = 返回」「屏幕中间左滑 = 内容操作」不会在同一次触摸里打架。

const Stack = createNativeStackNavigator();

// 深浅色：导航容器自己的主题也要跟着换，否则转场时会闪一下系统默认白底。
function navThemeFor(scheme, C) {
  const base = scheme === 'light' ? DefaultTheme : DarkTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      background: C.bg,
      card: C.bg,
      text: C.ink,
      border: C.line,
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
  const { C } = useTheme();
  const theme = useMemo(() => navThemeFor(scheme, C), [scheme, C]);

  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator
        initialRouteName="Boot"
        screenOptions={{
          headerShown: false, // 三个页面各自画头，避免双头
          animation: 'slide_from_right', // 原生推入，不自定义转场
          gestureEnabled: true, // 左边缘返回
          fullScreenGestureEnabled: false, // 只留边缘手势，给观点库让出中间区域
          fullScreenGestureShadowEnabled: false,
          contentStyle: { backgroundColor: C.bg }, // 转场期间不露白底
        }}
      >
        <Stack.Screen name="Boot" component={BootScreen} options={{ animation: 'none' }} />
        <Stack.Screen name="Setup" component={SetupRoute} />
        <Stack.Screen name="BotList" component={BotListRoute} />
        <Stack.Screen name="Chat" component={ChatRoute} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// 启动判定：读本机是否已配置过地址/口令，然后 replace 掉 Boot，避免返回到空白页
function BootScreen({ navigation }) {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
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
  return (
    <SetupScreen
      onDone={() => {
        // 配置完成后回列表；从列表点「设置」进来时，返回手势仍会正常出栈
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
        // navigate 而不是 push：同一路由只保留一个实例，连点也不会重复压栈
        navigation.navigate('Chat', { bot });
      }}
      onSettings={() => navigation.navigate('Setup')}
    />
  );
}

function ChatRoute({ route, navigation }) {
  const bot = route.params?.bot;
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  // 参数丢了（例如热重载、深链）就退回上一层，绝不让 ChatScreen 拿着 undefined 去取 bot.id
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

const makeStyles = (C) =>
  StyleSheet.create({
    boot: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
    bootText: { color: C.ink2, fontSize: 13, lineHeight: 18 },
  });
