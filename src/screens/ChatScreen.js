import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { setCached, useCachedResource } from '../cache';
import { chat, openFeed, send, uploadImage } from '../api';
import { getBase } from '../store';
import { useKeyboardHeight } from '../keyboard';
import { useAppearOnce, useBounceOnce, usePressScale } from '../motion';

// 会话页（定案稿第二屏）：顶栏 44 高无分割线；消息区 flex:1；输入栏贴底；
// 气泡 最大宽 279 / 圆角 24 / 内边距 16 / 同人 4 / 换人 12；加载态 11pt + 三点；发送键 brand 底。
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

function LoadingDots({ s }) {
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
      style={{ flex: 1 }}
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
  const keyboardHeight = useKeyboardHeight();
  const sendPress = usePressScale(0.94);
  const backPress = usePressScale(0.94);

  const [draft, setDraft] = useState('');
  const [err, setErr] = useState(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [mode, setMode] = useState('');
  const [attachHint, setAttachHint] = useState(false);
  const reconnectCount = useRef(0);
  const [selectedImage, setSelectedImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState(false);
  const pickLock = useRef(false);
  const stopFeed = useRef(null);
  const liveRef = useRef(null);
  const seqs = useRef(new Set());
  const targetBot = useRef(String(bot.id));

  useEffect(() => {
    if (attachHint) {
      const t = setTimeout(() => setAttachHint(false), 3000);
      return () => clearTimeout(t);
    }
  }, [attachHint]);

  const applyMessages = useCallback((msgs) => {
    seqs.current = new Set(msgs.map((m) => m.seq).filter((x) => x !== undefined && x !== null));
    setItems(msgs);
  }, []);

  // 首次拉会话走缓存：有缓存直接渲染上次内容，后台静默刷新；key 按会话分开
  const chatCacheKey = useMemo(() => 'chat:' + String(bot.id), [bot.id]);

  const chatLoader = useCallback(async () => {
    try {
      const msgs = await chat(bot.id);
      setRefreshFailed(false);
      return msgs;
    } catch (e) {
      setRefreshFailed(true); // 有缓存时只提示一行小字，不整屏报错
      throw e;
    }
  }, [bot.id]);

  const cachedChat = useCachedResource(chatCacheKey, chatLoader);

  // 命中缓存时第一帧就有消息，不再先空一帧再填
  const [items, setItems] = useState(() => cachedChat.data || []);

  // 缓存命中或后台静默刷新回来了：把消息落到列表（流式追加逻辑不动）
  useEffect(() => {
    if (cachedChat.data) applyMessages(cachedChat.data);
  }, [cachedChat.data, applyMessages]);

  const load = useCallback(async () => {
    try {
      const msgs = await chat(bot.id);
      setCached(chatCacheKey, msgs); // 刷新结果写回缓存，下次点进来直接命中
      applyMessages(msgs);
      setErr(null);
      setRefreshFailed(false);
    } catch (e) {
      setErr({ step: e.step || 'chat', message: e.message || '读不到对话' });
    }
  }, [bot.id, chatCacheKey, applyMessages]);

  const onEvent = useCallback(
    (name, data) => {
      if (!data) return;
      if (name === 'hello') {
        setMode('live');
        reconnectCount.current = 0; // 成功连接，重置重连计数
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
    // 首次拉取交给 useCachedResource（有缓存就不转圈），这里只负责接流
    stopFeed.current = openFeed({
      onEvent,
      onError: (e) => {
        if (e && e.step === 'auth') {
          setErr({ step: 'auth', message: e.message });
          reconnectCount.current = 0;
          return;
        }
        reconnectCount.current += 1;
        // 只在前三次失败后显示重连状态
        if (reconnectCount.current === 3) {
          setMode('重连中');
        }
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

  const pickImage = useCallback(async (useCamera) => {
    // 防重入：选图进行中再点一次会并发弹第二个系统选择器，
    // 真机上能把原生选择器压死（退出不了、只能大退）
    if (pickLock.current) return;
    pickLock.current = true;
    setPicking(true);
    try {
      const options = {
        mediaTypes: ['images'],
        quality: 0.8,
        base64: false,
        allowsEditing: false,
      };

      let result;
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          setErr({ step: 'camera', message: '没有相机权限' });
          return;
        }
        result = await ImagePicker.launchCameraAsync(options);
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          setErr({ step: 'gallery', message: '没有相册权限' });
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync(options);
      }

      if (result.canceled) {
        // 用户取消选择：无图片要设，直接走 finally 复位
        return;
      }

      if (result.assets && result.assets[0]) {
        setSelectedImage(result.assets[0]);
      }
    } catch (error) {
      setErr({ step: 'pick', message: '选择图片失败: ' + error.message });
    } finally {
      // 取消 / 成功 / 失败 / 权限拒绝，所有出口统一在这里复位，
      // 不允许任何分支绕过
      pickLock.current = false;
      setPicking(false);
      setAttachHint(false);
    }
  }, []);

  async function onSend() {
    let finalText = draft.trim();
    
    // 如果有图片，先上传
    if (selectedImage) {
      setUploading(true);
      try {
        const uploadResult = await uploadImage(selectedImage.uri);
        const base = await getBase();
        const imageUrl = base.replace(/\/$/, '') + uploadResult.url;
        // 将图片URL附加到文本中
        if (finalText) {
          finalText = finalText + '\n' + imageUrl;
        } else {
          finalText = imageUrl;
        }
        // 上传成功后清除图片
        setSelectedImage(null);
      } catch (e) {
        setUploading(false);
        setErr({ step: 'upload', message: '图片没传上去，再试一次' });
        return;
      }
      setUploading(false);
    }
    
    if (!finalText) return;
    
    setDraft('');
    setErr(null);
    liveRef.current && liveRef.current.clear();
    const local = { who: '我', text: finalText, local: true };
    setItems((prev) => [...prev, local]);
    try {
      await send(bot.id, finalText);
    } catch (e) {
      setErr({ step: e.step || 'send', message: e.message || '发送失败' });
      setItems((prev) => prev.filter((m) => m !== local));
    }
  }

  const stepLabel = { chat: '读会话失败', send: '发送失败', auth: '需要重新登录', feed: '流式断开' };

  // 有缓存就保留内容、只提示一行小字；没有缓存才占整屏错误态
  const hasCache = cachedChat.data != null;
  const fetchErr = err || (cachedChat.error ? { step: 'chat', message: cachedChat.error } : null);
  const showErrBox = fetchErr && !hasCache ? fetchErr : null;
  const showRefreshHint = Boolean(fetchErr) && hasCache;

  return (
    <View style={[s.root, { paddingBottom: keyboardHeight }]}>
      <View style={[s.head, { height: insets.top + 44, paddingTop: insets.top }]}>
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
          {mode === 'live' ? '实时' : mode === '重连中' ? '网络断了，正在重试' : ''}
        </Text>
      </View>

      {showErrBox ? (
        <View style={s.errBox}>
          <Text style={s.errTitle} allowFontScaling={false}>
            {stepLabel[showErrBox.step] || '出错了'}
          </Text>
          <Text style={s.errMsg} allowFontScaling={false}>
            {showErrBox.message}
          </Text>
        </View>
      ) : null}

      {showRefreshHint ? (
        <Text
          style={{ color: C.ink3, fontSize: 12, paddingHorizontal: S.page, paddingBottom: S.x1 }}
          allowFontScaling={false}
        >
          {stepLabel[fetchErr.step] || '刷新失败'}，显示的是上次内容
        </Text>
      ) : null}

      <View style={s.body}>
        <View style={s.body}>
          {cachedChat.loading ? <LoadingDots s={s} /> : <MessageList items={items} C={C} T={T} S={S} R={R} />}
          <LiveBubble ref={liveRef} C={C} T={T} S={S} R={R} />
        </View>

        {selectedImage && (
          <View style={{ paddingHorizontal: S.page, paddingBottom: S.x2, alignItems: 'center' }}>
            <View style={{ width: 60, height: 60, borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
              <Image
                source={{ uri: selectedImage.uri }}
                style={{ width: 60, height: 60, borderRadius: 8 }}
              />
              <Pressable
                style={{ position: 'absolute', top: -4, right: -4, width: 20, height: 20, backgroundColor: C.bad, borderRadius: 10, justifyContent: 'center', alignItems: 'center' }}
                onPress={() => setSelectedImage(null)}
              >
                <Text style={{ color: C.onBad, fontSize: 12 }}>×</Text>
              </Pressable>
            </View>
          </View>
        )}
        
        <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, S.x3) + S.x2 }]}>
          <Pressable
            style={s.attachBtn}
            onPress={() => {
              // 显示简单的选择菜单
              setErr(null);
              setAttachHint(true);
            }}
          >
            <Text style={s.attachText}>+</Text>
          </Pressable>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="说点什么"
            placeholderTextColor={C.placeholder}
            multiline
            scrollEnabled
          />
          <Animated.View style={sendPress.scale}>
            <Pressable
              style={[s.sendBtn, uploading && { opacity: 0.7 }]}
              onPress={onSend}
              onPressIn={sendPress.onPressIn}
              onPressOut={sendPress.onPressOut}
              disabled={(!draft.trim() && !selectedImage) || uploading}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={C.onAccent} />
              ) : (
                <Text style={s.sendText} allowFontScaling={false}>
                  发送
                </Text>
              )}
            </Pressable>
          </Animated.View>
        </View>
        {attachHint ? (
          <View style={{ paddingHorizontal: S.page, paddingTop: S.x2, flexDirection: 'row', gap: S.x2 }}>
            <Pressable
              style={{ backgroundColor: C.card, paddingHorizontal: S.x3, paddingVertical: S.x2, borderRadius: R.small, opacity: picking ? 0.5 : 1 }}
              onPress={() => pickImage(false)}
              disabled={picking}
            >
              <Text style={{ color: C.ink, fontSize: 12 }}>从相册选</Text>
            </Pressable>
            <Pressable
              style={{ backgroundColor: C.card, paddingHorizontal: S.x3, paddingVertical: S.x2, borderRadius: R.small, opacity: picking ? 0.5 : 1 }}
              onPress={() => pickImage(true)}
              disabled={picking}
            >
              <Text style={{ color: C.ink, fontSize: 12 }}>拍照</Text>
            </Pressable>
            <Pressable
              style={{ backgroundColor: C.card, paddingHorizontal: S.x3, paddingVertical: S.x2, borderRadius: R.small }}
              onPress={() => setAttachHint(false)}
            >
              <Text style={{ color: C.ink, fontSize: 12 }}>取消</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
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
      height: 44, // 头部内容高度固定，总高度由外层 style + paddingTop 构成
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
      alignItems: 'center',
      gap: S.x2,
      paddingHorizontal: S.page,
      paddingTop: S.x3,
    },
    input: {
      flex: 1,
      width: 0,
      minHeight: 44,
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
    attachBtn: {
      backgroundColor: C.card,
      borderRadius: R.capsule,
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    attachText: { color: C.ink3, ...T.title },
  });
