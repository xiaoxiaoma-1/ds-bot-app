import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

// Full-screen quick capture for one idea. Pure UI: no requests here.
// Saving is delegated to props.onSave(text); closing is props.onClose().
// No borders anywhere — surfaces are separated by fill color and radius only.
export default function IdeaQuickAddScreen({ onSave, onClose, saving = false, error = null }) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');

  const trimmed = text.trim();
  const isEmpty = trimmed.length === 0;
  const disabled = isEmpty || saving;

  const handleSave = () => {
    if (disabled) return;
    onSave(trimmed);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: C.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header: title on the left, plain text close button on the right */}
      <View style={[styles.header, { paddingTop: insets.top + S.x4, paddingHorizontal: S.page }]}>
        <Text style={[T.title, { color: C.ink }]} numberOfLines={1} allowFontScaling={false}>
          记一条灵感
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={S.x4}
          accessibilityRole="button"
          accessibilityLabel="关闭"
        >
          <Text style={[T.body, { color: C.ink2 }]} allowFontScaling={false}>
            关闭
          </Text>
        </Pressable>
      </View>

      {/* Input area takes every pixel left between header and footer */}
      <View style={[styles.body, { paddingHorizontal: S.page, paddingTop: S.x4, gap: S.x2 }]}>
        <TextInput
          style={[T.body, styles.input, { color: C.ink, backgroundColor: C.card, borderRadius: R.small, padding: S.x4 }]}
          value={text}
          onChangeText={setText}
          placeholder="想到什么就写什么…"
          placeholderTextColor={C.placeholder}
          multiline
          autoFocus
          textAlignVertical="top"
          allowFontScaling={false}
        />
        {error ? (
          <Text style={[T.meta, { color: '#FF7A70' }]} allowFontScaling={false}>
            {error}
          </Text>
        ) : null}
      </View>

      {/* Primary action: cream capsule, disabled while empty or saving */}
      <View style={{ paddingHorizontal: S.page, paddingTop: S.x2, paddingBottom: insets.bottom + S.x5 }}>
        <Pressable
          onPress={handleSave}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          style={[
            styles.save,
            { backgroundColor: C.accent, borderRadius: R.capsule, opacity: disabled ? 0.6 : 1 },
          ]}
        >
          <Text style={[T.title, { color: C.onAccent }]} allowFontScaling={false}>
            {saving ? '保存中…' : '保存'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  body: { flex: 1 },
  // flex: 1 lets the field absorb height changes caused by the keyboard.
  input: { flex: 1 },
  save: { height: 52, alignItems: 'center', justifyContent: 'center' },
});
