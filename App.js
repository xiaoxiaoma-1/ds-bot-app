import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { C } from './src/theme';
import { isConfigured } from './src/store';
import SetupScreen from './src/screens/SetupScreen';
import BotListScreen from './src/screens/BotListScreen';
import ChatScreen from './src/screens/ChatScreen';

// 三个页面用状态切换，不引入导航库（红线：非必要不加依赖）。
export default function App() {
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
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <>
      {route === 'setup' ? (
        <SetupScreen onDone={() => setRoute('list')} />
      ) : route === 'chat' ? (
        <ChatScreen bot={bot} onBack={() => setRoute('list')} />
      ) : (
        <BotListScreen
          onOpen={(b) => {
            setBot(b);
            setRoute('chat');
          }}
          onSettings={() => setRoute('setup')}
        />
      )}
      <StatusBar style="light" />
    </>
  );
}

const s = StyleSheet.create({
  boot: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
});
