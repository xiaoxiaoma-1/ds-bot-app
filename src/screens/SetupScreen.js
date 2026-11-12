import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { C } from '../theme';
import { login } from '../api';
import { setBase, setPass } from '../store';

export default function SetupScreen({ onDone }) {
  const [base, setBaseText] = useState('');
  const [pass, setPassText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    const b = base.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(b)) {
      setErr('地址要以 http:// 或 https:// 开头');
      return;
    }
    if (!pass) {
      setErr('请填口令');
      return;
    }
    setBusy(true);
    try {
      await setBase(b);
      await setPass(pass);
      await login(b, pass);
      onDone();
    } catch (e) {
      setErr(e.locked ? `试太多次，${Math.ceil((e.left || 0) / 60)} 分钟后再来` : e.message || '连不上');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={s.title}>连上你的电脑</Text>
      <Text style={s.hint}>地址和口令只存在本机钥匙串，代码里没有它们。</Text>

      <Text style={s.label}>服务地址</Text>
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

      <Text style={s.label}>口令</Text>
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

      {err ? <Text style={s.err}>{err}</Text> : null}

      <Pressable style={[s.btn, busy && s.btnBusy]} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>连接</Text>}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, padding: 24, justifyContent: 'center' },
  title: { color: C.ink, fontSize: 24, fontWeight: '600' },
  hint: { color: C.ink2, fontSize: 13, marginTop: 6, marginBottom: 22 },
  label: { color: C.ink2, fontSize: 13, marginBottom: 6, marginTop: 10 },
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
  err: { color: C.bad, fontSize: 13, marginTop: 14 },
  btn: {
    backgroundColor: C.accent,
    borderRadius: 10,
    marginTop: 24,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnBusy: { opacity: 0.7 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
