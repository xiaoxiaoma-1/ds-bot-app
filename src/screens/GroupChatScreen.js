import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useKeyboardShift } from '../keyboard';
import { groupApi } from '../botApi';
import { TidyButton, useTidy } from '../tidy';

// 群会话页：GET /api/dsbot/group 一页 20 条（seq 升序），cursor 往上翻。
// 群日志没有时间戳（at 恒为 null），所以不显示时间；「谁说的」用 whoName，自己说的是 'me'。
const BUBBLE_MAX = 279;

export default function GroupChatScreen({ group, onBack }) {
  const { C, T, S, R } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();
  const listRef = useRef(null);
  const keyboardShift = useKeyboardShift();
  const keyboardMove = useMemo(
    () => ({ transform: [{ translateY: Animated.multiply(keyboardShift, -1) }] }),
    [keyboardShift],
  );

  const [info, setInfo] = useState(group || null);
  const [msgs, setMsgs] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const tidy = useTidy({ value: draft, onChange: setDraft });
  const [err, setErr] = useState(null);
  const [pendingHint, setPendingHint] = useState('');

  const id = String((group && group.id) || '');

  const load = useCallback(async () => {
    setErr(null);
    try {
      const d = await groupApi.chat(id);
      setInfo(d.group || info);
      setMsgs(Array.isArray(d.messages) ? d.messages : []);
      setCursor(d.cursor || null);
      setNote(d.note || '');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!cursor || more) return;
    setMore(true);
    try {
      const d = await groupApi.chat(id, cursor);
      const older = Array.isArray(d.messages) ? d.messages : [];
      setMsgs((prev) => older.concat(prev));
      setCursor(d.cursor || null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setMore(false);
    }
  }, [cursor, more, id]);

  const onSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setErr(null);
    setSending(true);
    setPendingHint('');
    // 先把自己那句挂上去，别等往返（后端最长 1.2 秒）
    setMsgs((prev) => prev.concat([{ seq: 'local-' + Date.now(), who: 'me', whoName: '我', text, local: true }]));
    try {
      const d = await groupApi.send(id, text);
      setMsgs(Array.isArray(d.messages) ? d.messages : []);
      setCursor(d.cursor || null);
      if (d.group) setInfo(d.group);
      if (d.target === 'group' && d.reply) setPendingHint(d.reply);
    } catch (e) {
      setErr(e.message);
      setMsgs((prev) => prev.filter((m) => !m.local)); // 发失败就把那句撤掉，别留假消息
      setDraft(text);
    } finally {
      setSending(false);
    }
  }, [draft, sending, id]);

  const renderItem = useCallback(
    ({ item }) => {
      const mine = item.who === 'me';
      return (
        <View style={[s.row, mine ? s.right : s.left]}>
          {!mine ? (
            <Text style={s.who} numberOfLines={1} allowFontScaling={false}>
              {item.whoName || item.who}
            </Text>
          ) : null}
          <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs, item.local ? s.bubbleLocal : null]}>
            <Text style={s.bubbleText} allowFontScaling={false}>
              {item.text}
            </Text>
          </View>
          {item.cut ? (
            <Text style={s.cut} allowFontScaling={false}>
              超过 4000 字，只显示前 4000 字
            </Text>
          ) : null}
        </View>
      );
    },
    [s],
  );

  const modeText = info && info.mode === 'admin' ? '仅牵头' : '全员';

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.head}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.back} allowFontScaling={false}>
            返回
          </Text>
        </Pressable>
        <Text style={s.title} numberOfLines={1} allowFontScaling={false}>
          {(info && info.name) || '群组'}
        </Text>
        <Text style={s.mode} allowFontScaling={false}>
          {modeText}
        </Text>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.accent} />
          <Text style={s.centerText} allowFontScaling={false}>
            正在取群消息
          </Text>
        </View>
      ) : (
        <Animated.View style={[s.body, keyboardMove]}>
          <FlatList
            ref={listRef}
            data={msgs}
            keyExtractor={(m) => String(m.seq)}
            renderItem={renderItem}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingVertical: S.x4 }}
            onContentSizeChange={() => listRef.current && listRef.current.scrollToEnd({ animated: false })}
            ListHeaderComponent={
              cursor ? (
                <Pressable style={s.moreBtn} onPress={loadMore} disabled={more}>
                  <Text style={s.moreText} allowFontScaling={false}>
                    {more ? '正在取更早的' : '看更早的消息'}
                  </Text>
                </Pressable>
              ) : null
            }
            ListEmptyComponent={
              <View style={s.center}>
                <Text style={s.centerText} allowFontScaling={false}>
                  这个群还没有消息
                </Text>
              </View>
            }
            ListFooterComponent={
              pendingHint ? (
                <Text style={s.pending} allowFontScaling={false}>
                  {pendingHint}
                </Text>
              ) : null
            }
          />

          {err ? (
            <Pressable onPress={() => setErr(null)} style={s.errLine}>
              <Text style={s.errText} numberOfLines={2} allowFontScaling={false}>
                {err}
              </Text>
            </Pressable>
          ) : null}

          {note ? (
            <Text style={s.note} allowFontScaling={false}>
              {note}
            </Text>
          ) : null}

          {tidy.errMsg ? (
            <Pressable onPress={tidy.clearErr} style={s.tidyErrLine}>
              <Text style={s.tidyErr} numberOfLines={2} allowFontScaling={false}>
                {tidy.errMsg}
              </Text>
            </Pressable>
          ) : null}

          <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, S.x3) }]}>
            <View style={s.inputWrap}>
              <TextInput
                style={[s.input, tidy.busy ? s.inputDim : null]}
                value={draft}
                onChangeText={setDraft}
                placeholder="说点什么"
                placeholderTextColor={C.ink3}
                multiline
                editable={!sending && !tidy.busy}
                allowFontScaling={false}
              />
              {tidy.busy ? (
                <View style={s.tidyOverlay} pointerEvents="none">
                  <Text style={s.tidyOverlayText} allowFontScaling={false}>
                    整理中…
                  </Text>
                </View>
              ) : null}
            </View>
            <TidyButton busy={tidy.busy} disabled={!tidy.canRun || sending} onPress={tidy.run} />
            <Pressable
              style={[s.sendBtn, sending || !draft.trim() ? s.sendDim : null]}
              onPress={onSend}
              disabled={sending || !draft.trim()}
            >
              <Text style={s.sendText} allowFontScaling={false}>
                发送
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const makeStyles = (C, T, S, R) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    body: { flex: 1 },
    head: {
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: S.page,
      gap: S.x3,
    },
    back: { color: C.ink2, ...T.body },
    title: { color: C.ink, ...T.title, flex: 1, textAlign: 'center' },
    mode: { color: C.ink3, ...T.meta, width: 40, textAlign: 'right' },
    center: { alignItems: 'center', justifyContent: 'center', paddingVertical: S.x8, gap: S.x2 },
    centerText: { color: C.ink3, ...T.meta, textAlign: 'center' },
    moreBtn: { alignSelf: 'center', paddingVertical: S.x3, paddingHorizontal: S.x4 },
    moreText: { color: C.ink2, ...T.meta },
    row: { paddingHorizontal: S.page, marginBottom: S.x1 },
    left: { alignItems: 'flex-start' },
    right: { alignItems: 'flex-end' },
    who: { color: C.ink3, ...T.meta, marginBottom: S.x1, marginTop: S.x2 },
    bubble: {
      maxWidth: BUBBLE_MAX,
      borderRadius: R.small,
      paddingHorizontal: S.x4,
      paddingVertical: S.x4,
    },
    bubbleMine: { backgroundColor: C.me },
    bubbleTheirs: { backgroundColor: C.card },
    bubbleLocal: { opacity: 0.6 },
    bubbleText: { color: C.ink, ...T.body },
    cut: { color: C.ink3, ...T.meta, marginTop: S.x1 },
    pending: { color: C.ink3, ...T.meta, textAlign: 'center', paddingVertical: S.x3 },
    errLine: { paddingHorizontal: S.page, paddingBottom: S.x2 },
    errText: { color: C.bad, ...T.meta },
    note: { color: C.ink3, ...T.meta, paddingHorizontal: S.page, paddingBottom: S.x2 },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: S.x2,
      paddingHorizontal: S.page,
      paddingTop: S.x3,
    },
    input: {
      flex: 1,
      maxHeight: 120,
      backgroundColor: C.card,
      borderRadius: R.capsule,
      color: C.ink,
      ...T.body,
      paddingHorizontal: S.x4,
      paddingVertical: S.x3,
    },
    sendBtn: {
      backgroundColor: C.accent,
      borderRadius: R.capsule,
      paddingHorizontal: S.x4,
      paddingVertical: S.x3,
    },
    sendDim: { opacity: 0.5 },
    sendText: { color: C.onAccent, ...T.body },
    inputWrap: { flex: 1, justifyContent: 'center' },
    inputDim: { opacity: 0.35 },
    tidyOverlay: {
      position: 'absolute',
      left: S.x4,
      right: S.x4,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
    },
    tidyOverlayText: { color: C.ink3, ...T.body },
    tidyErrLine: { paddingHorizontal: S.page, paddingBottom: S.x2 },
    tidyErr: { color: C.bad, ...T.meta },
  });
