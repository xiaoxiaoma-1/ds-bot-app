import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { C } from '../theme';
import { chat, openFeed, send } from '../api';

// 功能二 + 三：会话历史 + 发消息 + 流式回复。
// 历史：GET /api/dsbot/chat?bot=<id>，一次给全部（代理层还没透出 cursor，翻页先禁用）。
// 发送：POST /api/dsbot/send {bot, text}。
// 流式：优先 SSE GET /api/bot/feed（'stream' 事件）；该路由不存在时自动降级为轮询。

const POLL_MS = 1500;
const POLL_MAX = 30;

export default function ChatScreen({ bot, onBack }) {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [live, setLive] = useState('');
  const [mode, setMode] = useState('');
  const stopFeed = useRef(null);
  const pollTimer = useRef(null);
  const lastCount = useRef(0);

  const stopAll = useCallback(() => {
    stopFeed.current && stopFeed.current();
    stopFeed.current = null;
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const load = useCallback(async () => {
    try {
      const msgs = await chat(bot.id);
      setItems(msgs);
      lastCount.current = msgs.length;
      setErr('');
    } catch (e) {
      setErr(e.message || '读不到对话');
    } finally {
      setLoading(false);
    }
  }, [bot.id]);

  useEffect(() => {
    load();
    return stopAll;
  }, [load, stopAll]);

  const startPoll = useCallback(() => {
    setMode('poll');
    let ticks = 0;
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      ticks += 1;
      try {
        const msgs = await chat(bot.id);
        if (msgs.length > lastCount.current) {
          setItems(msgs);
          lastCount.current = msgs.length;
          setLive('');
        }
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          if (last.who !== '我') setLive(last.text);
        }
      } catch {}
      if (ticks >= POLL_MAX) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
        setLive('');
      }
    }, POLL_MS);
  }, [bot.id]);

  async function onSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setErr('');
    const before = items;
    setItems([...before, { who: '我', text, local: true }]);
    setLive(' ');
    try {
      await send(bot.id, text);
    } catch (e) {
      setErr(e.message || '发送失败');
      setLive('');
      setItems(before);
      return;
    }

    let gotEvent = false;
    stopAll();
    stopFeed.current = openFeed({
      onEvent: (name, data) => {
        if (name !== 'stream' && name !== 'message') return;
        gotEvent = true;
        setMode('sse');
        const botId = data && data.botId;
        if (botId && String(botId) !== String(bot.id)) return;
        if (name === 'stream') {
          const chunk = data.text || data.delta || '';
          if (chunk) setLive((prev) => (prev === ' ' ? chunk : prev + chunk));
        }
        if (name === 'message' && data.item && typeof data.item.text === 'string') {
          setLive('');
          load();
        }
      },
      onError: () => {
        if (gotEvent) return;
        stopAll();
        startPoll();
      },
    });
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  const view = [...items].reverse();

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={s.head}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.back}>‹ 返回</Text>
        </Pressable>
        <Text style={s.title} numberOfLines={1}>
          {bot.name}
        </Text>
        <Text style={s.mode}>{mode === 'sse' ? '流式' : mode === 'poll' ? '轮询' : ''}</Text>
      </View>

      {err ? <Text style={s.err}>{err}</Text> : null}

      <FlatList
        data={view}
        inverted
        keyExtractor={(it, i) => String(it.at || '') + i}
        contentContainerStyle={{ paddingVertical: 10 }}
        ListHeaderComponent={
          <Pressable disabled style={s.older}>
            <Text style={s.olderText}>更早的历史：代理层补上 cursor 后开放</Text>
          </Pressable>
        }
        renderItem={({ item }) => {
          const mine = item.who === '我';
          return (
            <View style={[s.bubbleRow, mine ? s.right : s.left]}>
              <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]}>
                <Text style={s.bubbleText}>{item.text}</Text>
              </View>
            </View>
          );
        }}
      />

      {live ? (
        <View style={[s.bubbleRow, s.left]}>
          <View style={[s.bubble, s.bubbleTheirs]}>
            <Text style={s.bubbleText}>{live}</Text>
          </View>
        </View>
      ) : null}

      <View style={s.composer}>
        <TextInput
          style={s.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="说点什么"
          placeholderTextColor={C.ink3}
          multiline
        />
        <Pressable style={s.sendBtn} onPress={onSend} disabled={!draft.trim()}>
          <Text style={s.sendText}>发送</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomColor: C.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  back: { color: C.accent, fontSize: 15 },
  title: { color: C.ink, fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'center' },
  mode: { color: C.ink3, fontSize: 11, width: 34, textAlign: 'right' },
  err: { color: C.bad, fontSize: 13, paddingHorizontal: 14, paddingTop: 8 },
  older: { alignItems: 'center', paddingVertical: 12 },
  olderText: { color: C.ink3, fontSize: 11 },
  bubbleRow: { paddingHorizontal: 14, marginVertical: 4 },
  left: { alignItems: 'flex-start' },
  right: { alignItems: 'flex-end' },
  bubble: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleMine: { backgroundColor: C.me },
  bubbleTheirs: { backgroundColor: C.card },
  bubbleText: { color: C.ink, fontSize: 15, lineHeight: 21 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopColor: C.line,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: C.card,
    borderRadius: 12,
    color: C.ink,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sendBtn: { backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11 },
  sendText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
