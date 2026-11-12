import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// 第一步只证明「云端能出免签名 ipa」。界面留到第二步。
// 红线二：服务地址不进代码，改为运行时设置项。
export default function App() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>DS Bot</Text>
      <Text style={styles.note}>构建链路验证包</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0b0e12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: '#e6e9ee', fontSize: 28, fontWeight: '600' },
  note: { color: '#8b93a1', fontSize: 15, marginTop: 8 },
});
