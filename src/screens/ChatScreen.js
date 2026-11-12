import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
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
import { useTheme } from '../theme';
import { chat, openFeed, send } from '../api';

// 功能二 + 三：会话历史 + 发消息 + 流式回复。
// 结构上两条硬约束（对应两个真机 bug）：
//   1. 消息区永远是 flex:1 的容器，加载指示画在它内部 —— 输入栏因此始终贴底，不会被顶到半空。
//   2. 流式增量不碰父组件 state，走 LiveBubble 的 ref 局部更新 + rAF 合并 —— 不带动整个列表重渲染。

const BubbleRow = memo(function BubbleRow({ item, s }) {
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
});

const MessageList = memo(function MessageList({ items, C }) {
  const s = useMemo(() => makeStyles(C), [C]);
  const renderItem = useCallback(({ item }) => <BubbleRow item={item} s={s} />, [s]);
  const keyExtractor = useCallback((it, i) => {
    if (it.seq !== undefined && it.seq !== null) return 's' + it.seq;
    if (it.at !== undefined && it.at !== null) return 't' + it.at + '|' + String(it.text).slice(0, 8);
    return 'i' + i;
  }, []);
  const data = useMemo(() => [...items].reverse(), [items]);

  return (
    <FlatList
      data={data}
      inverted
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      initialNumToRender={14}
      maxToRenderPerBatch={10}
      windowSize={9}
      removeClippedSubviews
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
    />
  );
});

// 正在吐的那条气泡：自己管自己的文本，父组件不参与
const LiveBubble = memo(
  forwardRef(function LiveBubble({ C }, ref) {
    const s = useMemo(() => makeStyles(C), [C]);
    const [text, setText] = useState('');
    const buf = useRef('');
    const raf = useRef(null);

    const flush = useCallback(() => {
      raf.current = null;
      setText(buf.current);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        append(chunk) {
          buf.current += chunk;
          // 一帧最多刷一次：SSE 每片都 setState 会打出 30+ 次/秒的重渲染
          if (raf.current === null) raf.current = requestAnimationFrame(flush);
        },
        clear() {
          buf.current = '';
          if (raf.current !== null) {
            cancelAnimationFrame(raf.current);
            raf.current = null;
          }
          setText('');
        },
        finish() {
          if (raf.current !== null) {
            cancelAnimationFrame(raf.current);
            raf.current = null;
          }
          setText(buf.current);
        },
      }),
      [flush],
    );

    useEffect(
      () => () => {
        if (raf.current !== null) cancelAnimationFrame(raf.current);
        raf.current = null;
      },
      [],
    );

    if (!text) return null;
    return (
      <View style={[s.bubbleRow, s.left]}>
        <View style={[s.bubble, s.bubbleTheirs]}>
          <Text style={s.bubbleText} allowFontScaling={false}>
            {text}
          </Text>
        </View>
      </View>
    );
  }),
);

export default function ChatScreen({ bot, onBack }) {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [mode, setMode] = useState('');
  const stopFeed = useRef(null);
  const liveRef = useRef(null);
  const seqs = useRef(new Set());
  const targetBot = useRef(String(bot.id));

  const applyMessages = useCallback((msgs) => {
    seqs.current = new Set(msgs.map((m) => m.seq).filter((x) => x !== undefined && x !== null));
    setItems(msgs);
  }, []);

  const load = useCallback(async () => {
    try {
      const msgs = await chat(bot.id);
      applyMessages(msgs);
      setErr(null);
    } catch (e) {
      setErr({ step: e.step || 'chat', message: e.message || '读不到对话' });
    } finally {
      setLoading(false);
    }
  }, [bot.id, applyMessages]);

  const onEvent = useCallback(
    (name, data) => {
      if (!data) return;
      if (name === 'hello') {
        setMode('live');
        load();
        return;
      }
      if (data.botId && String(data.botId) !== targetBot.current) return;

      if (name === 'stream') {
        if (data.phase === 'start') {
          liveRef.current && liveRef.current.clear();
        } else if (data.phase === 'end') {
          liveRef.current && liveRef.current.finish();
        } else if (typeof data.text === 'string' && data.text) {
          liveRef.current && liveRef.current.append(data.text);
        }
        return;
      }

      if (name === 'message') {
        const item = data.item || {};
        const seq = item.seq;
        if (seq !== undefined && seq !== null) {
          if (seqs.current.has(seq)) return;
          seqs.current.add(seq);
        }
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (!text) return;
        const who = item.kind === 'user' ? '我' : '顾问';
        setItems((prev) => {
          if (who === '我') {
            const i = prev.findIndex((m) => m.local && m.text === text);
            if (i >= 0) {
              const next = prev.slice();
              next[i] = { who, text, at: item.time, seq };
              return next;
            }
          }
          return [...prev, { who, text, at: item.time, seq }];
        });
        if (who !== '我') liveRef.current && liveRef.current.clear();
      }
    },
    [load],
  );

  useEffect(() => {
    targetBot.current = String(bot.id);
    load();
    stopFeed.current = openFeed({
      onEvent,
      onError: (e) => {
        if (e && e.step === 'auth') {
          setErr({ step: 'auth', message: e.message });
          return;
        }
        setMode('reconnecting');
      },
      onAuthFail: (e) => {
        stopFeed.current && stopFeed.current();
        stopFeed.current = null;
        setErr({ step: 'auth', message: e.message || '会话过期，请重新登录' });
      },
    });
    return () => {
      stopFeed.current && stopFeed.current();
      stopFeed.current = null;
    };
  }, [bot.id, load, onEvent]);

  async function onSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setErr(null);
    liveRef.current && liveRef.current.clear();
    const local = { who: '我', text, local: true };
    setItems((prev) => [...prev, local]);
    try {
      await send(bot.id, text);
    } catch (e) {
      setErr({ step: e.step || 'send', message: e.message || '发送失败' });
      setItems((prev) => prev.filter((m) => m !== local));
    }
  }

  const stepLabel = { chat: '读会话失败', send: '发送失败', auth: '需要重新登录', feed: '流式断开' };

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
          {mode === 'live' ? '实时' : mode === 'reconnecting' ? '重连' : ''}
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

      {/* 关键：消息区永远是 flex:1，加载/空/列表都画在里面，输入栏因此固定贴底 */}
      <View style={s.body}>
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={C.accent} />
            <Text style={s.centerText} allowFontScaling={false}>
              正在读会话
            </Text>
          </View>
        ) : (
          <MessageList items={items} C={C} />
        )}
        <LiveBubble ref={liveRef} C={C} />
      </View>

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

const makeStyles = (C) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    body: { flex: 1 },
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
    sendText: { color: '#ffffff', fontSize: 15, fontWeight: '600', lineHeight: 20 },
  });
