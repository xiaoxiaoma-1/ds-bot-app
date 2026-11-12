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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';
import { chat, openFeed, send } from '../api';

// 功能二 + 三：会话历史 + 发消息 + 流式回复。
// 历史：GET /api/dsbot/chat?bot=<id>，一次给全部（代理层还没透出 cursor，翻页先禁用）。
// 发送：POST /api/dsbot/send {bot, text}。
// 流式：优先 SSE GET /api/bot/feed（'stream' 事件）；该路由不存在时自动降级轮询。

const POLL_MS = 1500;
const POLL_MAX = 30;

export default function ChatScreen({ bot, onBack }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
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
      setErr(null);
    } catch (e) {
      setErr({ step: e.step || 'chat', message: e.message || '读不到对话' });
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
    setErr(null);
    const before = items;
    setItems([...before, { who: '我', text, local: true }]);
    setLive(' ');
    try {
      await send(bot.id, text);
    } catch (e) {
      setErr({ step: e.step || 'send', message: e.message || '发送失败' });
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

  const stepLabel = { chat: '读会话失败', send: '发送失败', auth: '认证失败', feed: '流式断开' };

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[s.head, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.back} allowFontScaling={false}>
            ‹ 返回
          </Text>
        </Pressable>
        <Text style={s.title} numberOfLines={1} allowFontScaling={false}>
          {bot.name}
        </Text>
        <Text style={s.mode} allowFontScaling={false}>
          {mode === 'sse' ? '流式' : mode === 'poll' ? '轮询' : ''}
        </Text>
      </View>

      {err ? (
        <View style={s.errBox}>
          <Text style={s.errTitle} allowFontScaling={false}>
            {stepLabel[err.step] || '出错了'}
          </Text>
          <Text style={s.errMsg} allowFontScaling={false}>
            {err.message}
          </Text>
        </View>
      ) : null}

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.accent} />
          <Text style={s.centerText} allowFontScaling={false}>
            正在读会话
          </Text>
        </View>
      ) : (
        <FlatList
          data={[...items].reverse()}
          inverted
          keyExtractor={(it, i) => String(it.at || '') + i}
          contentContainerStyle={{ paddingVertical: 10 }}
          ListHeaderComponent={
            <View style={s.older}>
              <Text style={s.olderText} allowFontScaling={false}>
                更早的历史：代理层补上 cursor 后开放
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={s.center}>
              <Text style={s.centerText} allowFontScaling={false}>
                这个会话还没有消息
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const mine = item.who === '我';
            return (
              <View style={[s.bubbleRow, mine ? s.right : s.left]}>
                <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]}>
                  <Text style={s.bubbleText} allowFontScaling={false}>
                    {item.text}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {live ? (
        <View style={[s.bubbleRow, s.left]}>
          <View style={[s.bubble, s.bubbleTheirs]}>
            <Text style={s.bubbleText} allowFontScaling={false}>
              {live}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TextInput
          style={s.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="说点什么"
          placeholderTextColor={C.ink3}
          multiline
        />
        <Pressable style={s.sendBtn} onPress={onSend} disabled={!draft.trim()}>
          <Text style={s.sendText} allowFontScaling={false}>
            发送
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 10 },
  centerText: { color: C.ink3, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomColor: C.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  back: { color: C.accent, fontSize: 15, lineHeight: 20 },
  title: { color: C.ink, fontSize: 16, fontWeight: '600', lineHeight: 22, flex: 1, textAlign: 'center' },
  mode: { color: C.ink3, fontSize: 11, lineHeight: 16, width: 34, textAlign: 'right' },
  errBox: {
    margin: 14,
    padding: 12,
    backgroundColor: C.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    gap: 4,
  },
  errTitle: { color: C.bad, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  errMsg: { color: C.ink, fontSize: 13, lineHeight: 19 },
  older: { alignItems: 'center', paddingVertical: 12 },
  olderText: { color: C.ink3, fontSize: 11, lineHeight: 16 },
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
    paddingHorizontal: 10,
    paddingTop: 10,
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
  sendText: { color: '#fff', fontSize: 15, fontWeight: '600', lineHeight: 20 },
});
