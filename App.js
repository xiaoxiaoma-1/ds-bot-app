import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/theme';
import { isConfigured } from './src/store';
import SetupScreen from './src/screens/SetupScreen';
import BotListScreen from './src/screens/BotListScreen';
import ChatScreen from './src/screens/ChatScreen';

// 三个页面用状态切换，不引入导航库（红线：非必要不加依赖）。
// SafeAreaProvider 必须包在最外层，页面里才能用 useSafeAreaInsets。
// useColorScheme() 订阅系统外观：切浅色/深色时它变化 → ThemeProvider 重算调色板
// → 所有 useTheme() 的页面重渲染。只在启动读一次是通不了的，这个 hook 才是关键。
export default function App() {
  const scheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <ThemeProvider scheme={scheme}>
        <Root />
      </ThemeProvider>
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
    </SafeAreaProvider>
  );
}

function Root() {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState('setup');
  const [bot, setBot] = useState(null);

  const boot = useCallback(async () => {
    const ok = await isConfigured();
    setRoute(ok ? 'list' : 'setup');
    setReady(true);
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  if (!ready) {
    return (
      <View style={s.boot}>
        <ActivityIndicator color={C.accent} />
        <Text style={s.bootText} allowFontScaling={false}>
          正在读取本机设置
        </Text>
      </View>
    );
  }

  if (route === 'setup') {
    return <SetupScreen onDone={() => setRoute('list')} />;
  }
  if (route === 'chat' && bot) {
    return <ChatScreen bot={bot} onBack={() => setRoute('list')} />;
  }
  return (
    <BotListScreen
      onOpen={(b) => {
        setBot(b);
        setRoute('chat');
      }}
      onSettings={() => setRoute('setup')}
    />
  );
}

const makeStyles = (C) =>
  StyleSheet.create({
    boot: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
    bootText: { color: C.ink2, fontSize: 13, lineHeight: 18 },
  });
