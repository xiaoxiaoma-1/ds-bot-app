import { Component } from 'react';
import { Pressable, View, Text } from 'react-native';
import { useTheme } from '../theme';

// 全局兜底边界（2026-11-15）：
// 任何一屏抛异常，以前整个页面直接闪退、一个字的报错都看不到；现在先接住，
// 把 error.message 摆到屏幕上，点「重试」重新挂载。
// 用法：<ErrorBoundary name="表达训练">…</ErrorBoundary>
function CrashFallback({ name, err, onRetry }) {
  const { C, T, S, R } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, padding: S.x6, justifyContent: 'center', gap: S.x3 }}>
      <Text style={{ color: C.ink2, ...T.body }} allowFontScaling={false}>
        {name ? `${name}这一屏没渲染成功` : '这一屏没渲染成功'}
      </Text>
      <Text style={{ color: C.ink2, ...T.meta }} allowFontScaling={false}>
        {String((err && err.message) || err || '没有报错信息')}
      </Text>
      <Pressable
        style={{
          marginTop: S.x2,
          alignSelf: 'flex-start',
          height: 36,
          paddingHorizontal: S.x5,
          justifyContent: 'center',
          borderRadius: R.capsule,
          backgroundColor: C.card2,
        }}
        onPress={onRetry}
        accessibilityRole="button"
      >
        <Text style={{ color: C.ink, ...T.meta, fontWeight: '500' }} allowFontScaling={false}>重试</Text>
      </Pressable>
    </View>
  );
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
    this.reset = this.reset.bind(this);
  }

  componentDidCatch(error) {
    this.setState({ err: error });
    if (typeof console !== 'undefined' && console.error) {
      console.error(`[边界] ${this.props.name || ''} 渲染异常：`, error);
    }
  }

  reset() {
    this.setState({ err: null });
  }

  render() {
    if (this.state.err) {
      return <CrashFallback name={this.props.name} err={this.state.err} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}
