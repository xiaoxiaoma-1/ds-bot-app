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

// 导航：原生栈。边缘左滑返回靠 gestureEnabled + fullScreenGestureEnabled:false
//（只接管屏幕左边缘 20~30pt，中间区域留给页内内容）。
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
  const { C } = useTheme();
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
  return (
    <SetupScreen
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
      onOpen={(bot) => navigation.navigate('Chat', { bot })}
      onSettings={() => navigation.navigate('Setup')}
    />
  );
}

function ChatRoute({ route, navigation }) {
  const bot = route.params?.bot;
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

const makeStyles = (C, T, S) =>
  StyleSheet.create({
    boot: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: S.x3 },
    bootText: { color: C.ink2, ...T.meta },
  });
