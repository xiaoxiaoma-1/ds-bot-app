import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { chat, openFeed, send } from '../api';
import { useKeyboardShift } from '../keyboard';
import { TidyButton, useTidy } from '../tidy';
import { useAppearOnce, useBounceOnce, usePressScale } from '../motion';

// 会话页（定案稿第二屏）：顶栏 44 高无分割线；消息区 flex:1；输入栏贴底；
// 气泡最大宽 279 / 圆角 24 / 内边距 16 / 同人 4 / 换人 12；加载态 11pt + 三点；发送键 brand 底。
// 动效：气泡采纳 S3 弹一次、新消息轻跳一次，全部 native driver。

const BUBBLE_MAX = 279;

function useDots() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, {
        toValue: 3,
        duration: 900,
        easing: Easing.linear, // 循环动画不用弹簧
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return v;
}

function LoadingDots({ C, s }) {
  const v = useDots();
  const dot = (i) => {
    const opacity = v.interpolate({
      inputRange: [i, i + 0.5, i + 1, 3],
      outputRange: [0.25, 1, 0.25, 0.25],
    });
    return <Animated.View key={i} style={[s.dot, { opacity }]} />;
  };
  return (
    <View style={s.center}>
      <View style={s.dotsRow}>{[0, 1, 2].map(dot)}</View>
      <Text style={s.centerText} allowFontScaling={false}>
        正在读会话
      </Text>
    </View>
  );
}

const BubbleRow = memo(function BubbleRow({ item, prevWho, isLast, s }) {
  const appear = useAppearOnce(0);
  const bounce = useBounceOnce();
  const mine = item.who === '我';
  const sameSpeaker = prevWho === item.who;
  return (
    <Animated.View
      style={[
        s.bubbleRow,
        mine ? s.right : s.left,
        { marginTop: sameSpeaker ? 4 : 12 },
        appear.style,
        isLast ? bounce : null,
      ]}
    >
      <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]}>
        <Text style={s.bubbleText} allowFontScaling={false}>
          {item.text}
        </Text>
      </View>
    </Animated.View>
  );
});

const MessageList = memo(function MessageList({ items, C, T, S, R }) {
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const data = useMemo(() => [...items].reverse(), [items]);
  const renderItem = useCallback(
    ({ item, index }) => (
      <BubbleRow
        item={item}
        prevWho={data[index + 1] ? data[index + 1].who : undefined}
        isLast={index === 0}
        s={s}
      />
    ),
    [data, s],
  );
  const keyExtractor = useCallback((it, i) => {
    if (it.seq !== undefined && it.seq !== null) return 's' + it.seq;
    if (it.at !== undefined && it.at !== null) return 't' + it.at + '|' + String(it.text).slice(0, 8);
    return 'i' + i;
  }, []);

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
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingVertical: S.x3 }}
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

const LiveBubble = memo(
  forwardRef(function LiveBubble({ C, T, S, R }, ref) {
    const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
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
      <View style={[s.bubbleRow, s.left, { marginTop: 12 }]}>
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
  const { C, T, S, R } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();
  const keyboardShift = useKeyboardShift();
  const keyboardMove = useMemo(
    () => ({ transform: [{ translateY: Animated.multiply(keyboardShift, -1) }] }),
    [keyboardShift],
  );
  const sendPress = usePressScale(0.94);
  const backPress = usePressScale(0.94);

  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState('');
  const tidy = useTidy({ value: draft, onChange: setDraft });
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
        if (data.phase === 'start') liveRef.current && liveRef.current.clear();
        else if (data.phase === 'end') liveRef.current && liveRef.current.finish();
        else if (typeof data.text === 'string' && data.text) liveRef.current && liveRef.current.append(data.text);
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
    <View style={s.root}>
      <View style={[s.head, { paddingTop: insets.top }]}>
        <Animated.View style={backPress.scale}>
          <Pressable
            onPress={onBack}
            onPressIn={backPress.onPressIn}
            onPressOut={backPress.onPressOut}
            hitSlop={12}
          >
            <Text style={s.back} allowFontScaling={false}>
              ‹ 返回
            </Text>
          </Pressable>
        </Animated.View>
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

      <Animated.View style={[s.body, keyboardMove]}>
        <View style={s.body}>
          {loading ? <LoadingDots C={C} s={s} /> : <MessageList items={items} C={C} T={T} S={S} R={R} />}
          <LiveBubble ref={liveRef} C={C} T={T} S={S} R={R} />
        </View>

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
              editable={!tidy.busy}
            />
            {tidy.busy ? (
              <View style={s.tidyOverlay} pointerEvents="none">
                <Text style={s.tidyOverlayText} allowFontScaling={false}>
                  整理中…
                </Text>
              </View>
            ) : null}
          </View>
          <TidyButton busy={tidy.busy} disabled={!tidy.canRun} onPress={tidy.run} />
          <Animated.View style={sendPress.scale}>
            <Pressable
              style={s.sendBtn}
              onPress={onSend}
              onPressIn={sendPress.onPressIn}
              onPressOut={sendPress.onPressOut}
              disabled={!draft.trim()}
            >
              <Text style={s.sendText} allowFontScaling={false}>
                发送
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

const makeStyles = (C, T, S, R) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    body: { flex: 1 },
    center: { alignItems: 'center', justifyContent: 'center', paddingVertical: S.x8, gap: S.x2 },
    centerText: { color: C.ink3, ...T.meta, textAlign: 'center' },
    dotsRow: { flexDirection: 'row', gap: 6 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.ink3 },
    head: {
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: S.page,
      gap: S.x3,
    },
    back: { color: C.ink2, ...T.body },
    title: { color: C.ink, ...T.title, flex: 1, textAlign: 'center' },
    mode: { color: C.ink3, ...T.meta, width: 32, textAlign: 'right' },
    errBox: {
      margin: S.page,
      marginTop: 0,
      padding: S.x4,
      backgroundColor: C.card,
      borderRadius: R.small,
      gap: S.x1,
    },
    errTitle: { color: C.bad, ...T.title },
    errMsg: { color: C.ink2, ...T.body },
    bubbleRow: { paddingHorizontal: S.page },
    left: { alignItems: 'flex-start' },
    right: { alignItems: 'flex-end' },
    bubble: {
      maxWidth: BUBBLE_MAX,
      borderRadius: R.small,
      paddingHorizontal: S.x4,
      paddingVertical: S.x4,
    },
    bubbleMine: { backgroundColor: C.me },
    bubbleTheirs: { backgroundColor: C.card },
    bubbleText: { color: C.ink, ...T.body },
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
