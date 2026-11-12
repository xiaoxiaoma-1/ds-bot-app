import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from './theme';
import { speechApi } from './botApi';

// 「整理」：把口头文字压成书面语。只在用户点了才跑，不做自动触发。
// 五条行为：空文本按钮置灰；点后输入框就地进「整理中…」；回来替换原文；
// 失败保留原文并显示一句错误；changed=false（不足 4 字）不覆盖。
export function useTidy({ value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState(null);
  const running = useRef(false);

  const canRun = Boolean(String(value || '').trim()) && !busy;

  const run = useCallback(async () => {
    const text = String(value || '');
    if (!text.trim() || running.current) return; // 空文本不发；整理中不许连点
    running.current = true;
    setBusy(true);
    setErrMsg(null);
    try {
      const d = await speechApi.tidy(text);
      // changed=false 时后端原样返回（不到 4 字），不覆盖用户输入
      if (d && d.changed && typeof d.text === 'string' && d.text) onChange(d.text);
    } catch (e) {
      // 失败一律保留原文，只报一句
      setErrMsg(e.message || '整理失败');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [value, onChange]);

  const clearErr = useCallback(() => setErrMsg(null), []);

  return { busy, errMsg, canRun, run, clearErr };
}

export function TidyButton({ busy, disabled, onPress }) {
  const { C, T, S, R } = useTheme();
  const s = useStyles(C, T, S, R);
  const off = busy || disabled;
  return (
    <Pressable
      style={[s.btn, off ? s.off : null]}
      onPress={onPress}
      disabled={off}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={busy ? '正在整理' : '整理这段文字'}
    >
      <Text style={[s.text, busy ? s.textBusy : null]} allowFontScaling={false}>
        {busy ? '整理中' : '整理'}
      </Text>
    </Pressable>
  );
}

const useStyles = (C, T, S, R) =>
  StyleSheet.create({
    btn: {
      borderRadius: R.capsule,
      paddingHorizontal: S.x3,
      paddingVertical: S.x2,
      marginBottom: S.x1,
      backgroundColor: C.card,
      justifyContent: 'center',
    },
    off: { opacity: 0.4 },
    text: { color: C.ink2, ...T.meta },
    textBusy: { color: C.ink3 },
  });
