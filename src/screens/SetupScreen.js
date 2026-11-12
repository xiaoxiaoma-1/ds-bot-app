import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { login } from '../api';
import { setBase, setPass } from '../store';

export default function SetupScreen({ onDone }) {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const [base, setBaseText] = useState('');
  const [pass, setPassText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    setErr(null);
    const b = base.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(b)) {
      setErr({ step: '地址', message: '地址要以 http:// 或 https:// 开头' });
      return;
    }
    if (!pass) {
      setErr({ step: '口令', message: '口令不能为空' });
      return;
    }
    setBusy(true);
    try {
      await setBase(b);
      await setPass(pass);
      await login(b, pass);
      onDone();
    } catch (e) {
      const msg = e.locked
        ? `试太多次，${Math.ceil((e.left || 0) / 60)} 分钟后再来`
        : e.message || '连不上';
      setErr({ step: e.step === 'login' ? '登录失败' : '连接失败', message: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[s.root, { paddingTop: insets.top + 24 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Text style={s.title} allowFontScaling={false}>
          连上你的电脑
        </Text>
        <Text style={s.hint} allowFontScaling={false}>
          地址和口令只存在本机钥匙串，代码里没有它们。
        </Text>

        <Text style={s.label} allowFontScaling={false}>
          服务地址
        </Text>
        <TextInput
          style={s.input}
          value={base}
          onChangeText={setBaseText}
          placeholder="https://你的地址"
          placeholderTextColor={C.ink3}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          inputMode="url"
        />

        <Text style={s.label} allowFontScaling={false}>
          口令
        </Text>
        <TextInput
          style={s.input}
          value={pass}
          onChangeText={setPassText}
          placeholder="口袋口令"
          placeholderTextColor={C.ink3}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        {err ? (
          <View style={s.errBox}>
            <Text style={s.errTitle} allowFontScaling={false}>
              {err.step}
            </Text>
            <Text style={s.errMsg} allowFontScaling={false}>
              {err.message}
            </Text>
          </View>
        ) : null}

        <Pressable style={[s.btn, busy && s.btnBusy]} onPress={submit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={C.accent} />
          ) : (
            <Text style={s.btnText} allowFontScaling={false}>
              连接
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (C) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 24 },
    title: { color: C.ink, fontSize: 24, fontWeight: '700', lineHeight: 31 },
    hint: { color: C.ink2, fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: 20 },
    label: { color: C.ink2, fontSize: 13, lineHeight: 18, marginBottom: 6, marginTop: 10 },
    input: {
      backgroundColor: C.card,
      borderColor: C.line,
      borderWidth: 1,
      borderRadius: 10,
      color: C.ink,
      fontSize: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    errBox: {
      marginTop: 14,
      padding: 12,
      backgroundColor: C.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.line,
      gap: 4,
    },
    errTitle: { color: C.bad, fontSize: 13, fontWeight: '700', lineHeight: 18 },
    errMsg: { color: C.ink, fontSize: 13, lineHeight: 19 },
    btn: {
      backgroundColor: C.accent,
      borderRadius: 10,
      marginTop: 22,
      paddingVertical: 14,
      alignItems: 'center',
    },
    btnBusy: { opacity: 0.7 },
    btnText: { color: '#ffffff', fontSize: 16, fontWeight: '600', lineHeight: 22 },
  });
