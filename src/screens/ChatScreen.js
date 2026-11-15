import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Image,
  Modal,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LiveInput, { inputMaxHeight } from '../components/LiveInput';
import { useTheme } from '../theme';
import { setCached, useCachedResource } from '../cache';
import { chat, openFeed, send, uploadImage } from '../api';
import CachedImage from '../components/CachedImage';
import { THUMB_W } from '../imgCache';
import * as WebBrowser from 'expo-web-browser';
import { getBase } from '../store';
import { useKeyboardHeight } from '../keyboard';
import { useAppearOnce, useBounceOnce, usePressScale } from '../motion';

// 会话页（定案稿第二屏）：顶栏 44 高无分割线；消息区 flex:1；输入栏贴底；
// 气泡 最大宽 279 / 圆角 24 / 内边距 16 / 同人 4 / 换人 12；加载态 11pt + 三点；发送键 brand 底。
// 动效：气泡采纳 S3 弹一次、新消息轻跳一次，全部 native driver。

const BUBBLE_MAX = 279;
// K2：一次最多选 9 张
const MAX_PICK = 9;

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

// 2026-11-15：消息里如果带了我们服务端的上传链接，就拆出来单独渲染。
// 图片 → 缩略图直接显示，点了看大图；文档 → 一个「点开预览」卡片。
// 链接之外的文字照旧走文字气泡（不改动文案本身）。
const UPLOAD_RE = /https?:\/\/[^\s"'<>]*\/api\/dsbot\/uploads\/[^\s"'<>]+/g;
const IMG_EXT = /\.(png|jpe?g|webp|gif)(\?|$)/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|md|markdown|txt|csv)(\?|$)/i;

function splitAttachments(text) {
  const raw = String(text || '');
  const found = raw.match(UPLOAD_RE) || [];
  const clean = raw.replace(UPLOAD_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  const images = [];
  const docs = [];
  found.forEach((u) => {
    if (IMG_EXT.test(u)) images.push(u);
    else if (DOC_EXT.test(u)) docs.push(u);
  });
  return { clean, images, docs };
}

function docName(u) {
  try {
    const seg = String(u).split('?')[0].split('/').pop() || '文件';
    return decodeURIComponent(seg);
  } catch { return '文件'; }
}

const BubbleRow = memo(function BubbleRow({ item, prevWho, isLast, s, C, onOpenImage, onOpenDoc }) {
  const appear = useAppearOnce(0);
  const bounce = useBounceOnce();
  const mine = item.who === '我';
  const sameSpeaker = prevWho === item.who;
  const att = useMemo(() => splitAttachments(item.text), [item.text]);
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
        {att.clean ? (
          <Text style={s.bubbleText} allowFontScaling={false}>
            {att.clean}
          </Text>
        ) : null}
        {att.images.map((u) => (
          <Pressable key={u} onPress={() => onOpenImage && onOpenImage(u)} style={s.bubbleImgWrap}>
            <CachedImage uri={u} style={s.bubbleImg} resizeMode="cover" thumbWidth={THUMB_W} />
          </Pressable>
        ))}
        {att.docs.map((u) => (
          <Pressable
            key={u}
            onPress={() => onOpenDoc && onOpenDoc(u)}
            style={s.docCard}
            accessibilityRole="button"
            accessibilityLabel={`预览 ${docName(u)}`}
          >
            <Text style={s.docName} numberOfLines={1} allowFontScaling={false}>{docName(u)}</Text>
            <Text style={s.docHint} allowFontScaling={false}>点开预览</Text>
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
});

const MessageList = memo(function MessageList({ items, C, T, S, R, onOpenImage, onOpenDoc }) {
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const data = useMemo(() => [...items].reverse(), [items]);
  const renderItem = useCallback(
    ({ item, index }) => (
      <BubbleRow
        C={C}
        onOpenImage={onOpenImage}
        onOpenDoc={onOpenDoc}
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
  // 2026-11-15：消息里的附件（图片/文档）点开时用
  const [imgViewer, setImgViewer] = useState(null);
  const openImage = useCallback((u) => setImgViewer(u), []);
  const openDoc = useCallback(async (u) => {
    try {
      const sep = u.indexOf('?') >= 0 ? '&' : '?';
      await WebBrowser.openBrowserAsync(u + sep + 'preview=1', {
        toolbarColor: '#151518',
        controlsColor: '#ffffff',
      });
    } catch (e) {
      setErr({ step: '打不开这个文件', message: String((e && e.message) || e) });
    }
  }, []);
  // 问题 5（2026-11-15）：加号面板照微信重做。
  // attachHint 只是「在不在树上」，真正的出场/退场交给 attachAnim（24px 上滑 + 淡入）。
  const attachAnim = useRef(new Animated.Value(0)).current;
  const attachArmAt = useRef(0); // 面板刚挂上那一下不吃点击（通则 6：点外关闭要晚一帧）
  // 收起的动画比人慢：动画途中又点了一次加号时，必须让旧的「收起」作废，
  // 否则它播完把 attachHint 关掉，刚弹出的面板会被这一下顺手摘掉。
  const attachGen = useRef(0);
  const reconnectCount = useRef(0);
  const [selectedImages, setSelectedImages] = useState([]); // K2：批量选图，最多 MAX_PICK
  const [uploading, setUploading] = useState(false);
  const [uploadText, setUploadText] = useState('');
  const [picking, setPicking] = useState(false);
  const pickLock = useRef(false);
  const stopFeed = useRef(null);
  const liveRef = useRef(null);
  const seqs = useRef(new Set());
  const targetBot = useRef(String(bot.id));

  // 附件菜单不再 3 秒自动收回：点了就停在那儿，直到用户点空白 / 点输入框 / 选完图。

  // 从下往上弹（微信式）：先挂上树，下一帧再动，避免「瞬间出现」。
  // 2026-11-15：开面板时先把键盘收掉 —— 有面板就没有键盘，有键盘就没有面板。
  const openAttach = useCallback(() => {
    setErr(null);
    Keyboard.dismiss();
    attachArmAt.current = Date.now();
    attachGen.current += 1;
    attachAnim.setValue(0);
    setAttachHint(true);
    requestAnimationFrame(() => {
      Animated.timing(attachAnim, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [attachAnim]);

  // 缩回：先淡出+下滑，动完再从树上摘掉
  const closeAttach = useCallback(() => {
    attachGen.current += 1;
    const gen = attachGen.current;
    Animated.timing(attachAnim, {
      toValue: 0,
      duration: 150,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      // 这期间又开过一次 → 本次收起作废，不摘树
      if (finished && attachGen.current === gen) setAttachHint(false);
    });
  }, [attachAnim]);

  // 点输入框：键盘一上来就把两块按钮渐隐掉（键盘动画与淡出同帧起步，不用等松手）。
  // 只在「键盘升起」这一刻收：键盘本来就开着时点加号，面板要能留住。
  const kbPrev = useRef(0);
  useEffect(() => {
    const rising = keyboardHeight > kbPrev.current;
    kbPrev.current = keyboardHeight;
    if (rising && keyboardHeight > 0 && attachHint) closeAttach();
  }, [keyboardHeight, attachHint, closeAttach]);

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
        // K2：相册支持批量选，一次挑多张（拍照只能一张）
        result = await ImagePicker.launchImageLibraryAsync({
          ...options,
          allowsMultipleSelection: true,
          selectionLimit: MAX_PICK,
        });
      }

      if (result.canceled) {
        // 用户取消选择：无图片要设，直接走 finally 复位
        return;
      }

      const assets = (result.assets || []).filter((a) => a && a.uri);
      if (assets.length) {
        // 拍照/追加：并到已有列表里，最多 MAX_PICK 张
        setSelectedImages((prev) => {
          const next = useCamera ? [...prev, ...assets] : assets;
          return next.slice(0, MAX_PICK);
        });
      }
    } catch (error) {
      setErr({ step: 'pick', message: '选择图片失败: ' + error.message });
    } finally {
      // 取消 / 成功 / 失败 / 权限拒绝，所有出口统一在这里复位，
      // 不允许任何分支绕过
      pickLock.current = false;
      setPicking(false);
      closeAttach();
    }
  }, [closeAttach]);

  async function onSend() {
    let finalText = draft.trim();

    // 有图片，先一张张上传（K2：批量选、批量发，带「第几张/共几张」进度）
    if (selectedImages.length) {
      setUploading(true);
      const urls = [];
      try {
        const base = await getBase();
        for (let i = 0; i < selectedImages.length; i += 1) {
          setUploadText(`上传 ${i + 1}/${selectedImages.length}`);
          // 上传 Promise 可能一直不 settle（RN 带文件体的 fetch 在连接卡住时不会 reject，
          // 服务端日志里的 WinError 10053 是客户端先断，不是服务端拒），
          // 所以这里和时间赛跑：要么上传成功，要么到点自己放弃，转圈一定会停。
          const guard = new Promise((resolve) => setTimeout(() => resolve(null), 45000));
          const uploadResult = await Promise.race([
            uploadImage(selectedImages[i].uri),
            guard,
          ]);
          if (!uploadResult || !uploadResult.url) throw new Error(`第 ${i + 1} 张没传上去`);
          urls.push(String(base).replace(/\/$/, '') + uploadResult.url);
        }
        setSelectedImages([]);
        finalText = finalText ? finalText + '\n' + urls.join('\n') : urls.join('\n');
      } catch (e) {
        setErr({ step: 'upload', message: '图片没传上去：' + String((e && e.message) || '超时了，再试一次') });
        return; // 转圈由 finally 收
      } finally {
        // 任何分支（成功、失败、throw）都必须把转圈关掉
        setUploading(false);
        setUploadText('');
      }
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
          {cachedChat.loading ? <LoadingDots s={s} /> : <MessageList items={items} C={C} T={T} S={S} R={R} onOpenImage={openImage} onOpenDoc={openDoc} />}
          <LiveBubble ref={liveRef} C={C} T={T} S={S} R={R} />
          {/* 点消息区任意空白缩回：只吃点击，不盖任何遮罩色（通则 5）。
              挂上后的前 150ms 不响应，避免开面板的那一下立刻把它关掉（通则 6）。 */}
          {attachHint ? (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                if (Date.now() - attachArmAt.current > 150) closeAttach();
              }}
            />
          ) : null}
        </View>

        {selectedImages.length > 0 && (
          <View style={{ paddingHorizontal: S.page, paddingBottom: S.x2, flexDirection: 'row', flexWrap: 'wrap', gap: S.x2 }}>
            {selectedImages.map((img, i) => (
              <View key={String(img.uri) + i} style={{ width: 60, height: 60, borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                <Image
                  source={{ uri: img.uri }}
                  style={{ width: 60, height: 60, borderRadius: 8 }}
                />
                <Pressable
                  style={{ position: 'absolute', top: -4, right: -4, width: 20, height: 20, backgroundColor: C.bad, borderRadius: 10, justifyContent: 'center', alignItems: 'center' }}
                  onPress={() => setSelectedImages((prev) => prev.filter((_, k) => k !== i))}
                >
                  <Text style={{ color: C.onHero, ...T.meta }}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {uploading && uploadText ? (
          <Text style={{ color: C.ink3, ...T.meta, paddingHorizontal: S.page, paddingBottom: S.x2 }}>
            {uploadText}
          </Text>
        ) : null}
        
        {/* 问题 5（2026-11-15）：面板照微信逻辑重做。
            以前是「在流里突然出现」，屏幕上看着像从上方冒出来；并排三块里还有一块「取消」。
            现在：两块从下往上弹出（translateY 24→0 + 淡入），点空白缩回，没有「取消」，
            点输入框时跟键盘同帧渐隐。
            面板绝对定位在输入栏正上方（bottom:'100%'）：挂上/摘掉都不重排消息区，
            不会出现「先整块跳上去再补动画」。 */}
        <View style={s.composerWrap}>
        <View style={[s.composer, { paddingBottom: attachHint ? S.x2 : Math.max(insets.bottom, S.x3) + S.x6 }]}>
          <Pressable
            style={s.attachBtn}
            onPress={() => (attachHint ? closeAttach() : openAttach())}
          >
            <Text style={s.attachText}>+</Text>
          </Pressable>
          <View style={s.inputWrapper}>
            {/* 高到 5 行就停，再多的字在框内滚；输入栏本身的位置和高度上限都不动 */}
            <LiveInput
              style={s.input}
              minHeight={21}
              maxHeight={inputMaxHeight(21, 5)}
              value={draft}
              onChangeText={setDraft}
              placeholder="说点什么"
              placeholderTextColor={C.placeholder}
              scrollEnabled
            />
          </View>
          <Animated.View style={sendPress.scale}>
            <Pressable
              style={[s.sendBtn, uploading && { opacity: 0.7 }]}
              onPress={onSend}
              onPressIn={sendPress.onPressIn}
              onPressOut={sendPress.onPressOut}
              disabled={(!draft.trim() && selectedImages.length === 0) || uploading}
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

        {/* 附件面板：2026-11-15 按老板的要求挪到输入栏「下面」（原来放在输入栏正上方，
            所以看着像从聊天框上面冒出来）。现在它在输入栏之后、屏幕底部那一格，
            从下往上弹（translateY 24→0 + 淡入），开的时候输入栏自己收窄底部留白。 */}
        {/* 2026-11-15：消息里的图片点开看大图 */}
        <Modal visible={!!imgViewer} transparent animationType="fade" onRequestClose={() => setImgViewer(null)}>
          <Pressable style={s.imgBackdrop} onPress={() => setImgViewer(null)}>
            {imgViewer ? (
              <CachedImage uri={imgViewer} style={s.imgFull} resizeMode="contain" />
            ) : null}
          </Pressable>
        </Modal>

        {attachHint ? (
          <Animated.View
            style={[
              s.attachPanel,
              {
                paddingBottom: Math.max(insets.bottom, S.x3) + S.x4,
                opacity: attachAnim,
                transform: [
                  { translateY: attachAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
                ],
              },
            ]}
          >
            <Pressable
              style={[s.attachTile, picking ? s.attachPillOff : null]}
              onPress={() => pickImage(false)}
              disabled={picking}
              accessibilityRole="button"
              accessibilityLabel="从相册选"
            >
              {/* 相册图标：外框 + 中间一只「相片」 */}
              <View style={[s.tileIconFrame, { borderColor: C.ink2 }]}>
                <View style={[s.tileIconDot, { backgroundColor: C.accent }]} />
                <View style={[s.tileIconHill, { backgroundColor: C.ink2 }]} />
              </View>
              <Text style={s.attachTileText} allowFontScaling={false}>从相册选</Text>
            </Pressable>
            <Pressable
              style={[s.attachTile, picking ? s.attachPillOff : null]}
              onPress={() => pickImage(true)}
              disabled={picking}
              accessibilityRole="button"
              accessibilityLabel="拍照"
            >
              {/* 拍照图标：机身 + 镜头 */}
              <View style={[s.tileIconCamera, { borderColor: C.ink2 }]}>
                <View style={[s.tileIconLens, { backgroundColor: C.accent }]} />
              </View>
              <Text style={s.attachTileText} allowFontScaling={false}>拍照</Text>
            </Pressable>
          </Animated.View>
        ) : null}
        </View>
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
    bubbleImgWrap: { marginTop: S.x1, borderRadius: 8, overflow: 'hidden' },
    bubbleImg: { width: 180, height: 180 },
    docCard: {
      marginTop: S.x1,
      paddingHorizontal: S.x3,
      paddingVertical: S.x2,
      borderRadius: 8,
      backgroundColor: C.card2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.x2,
    },
    docName: { flex: 1, minWidth: 0, color: C.ink, ...T.body },
    docHint: { color: C.ink3, ...T.meta },
    imgBackdrop: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
    imgFull: { width: '100%', height: '100%' },
    bubbleText: { color: C.ink, ...T.body },
    // 输入栏外壳：只做定位基准，面板贴在它正上方（消息区不重排）
    composerWrap: { position: 'relative' },
    composer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.x2,
      paddingHorizontal: S.page,
      paddingTop: S.x3,
    },
    inputWrapper: {
      flex: 1,
      width: 0,
      minHeight: 44,
      // 5 行文字 + 上下各 12 的内边距：到顶就停，多出来的字由输入框自己滚
      maxHeight: inputMaxHeight(21, 5) + 24,
      backgroundColor: C.card,
      // 2026-11-15（老板）：胶囊两头是圆的，字一长左右就被弧线吃掉一段 → 改成普通长方形框
      borderRadius: 8,
      overflow: 'hidden',
      paddingVertical: S.x3,
      justifyContent: 'center',
    },
    input: {
      width: '100%',
      color: C.ink,
      ...T.body,
      paddingVertical: 0,
      paddingHorizontal: S.x4,
      textAlignVertical: 'top',
      textAlign: 'left',
    },
    sendBtn: {
      backgroundColor: C.accent,
      borderRadius: R.capsule,
      paddingHorizontal: S.x4,
      paddingVertical: S.x3,
    },
    sendText: { color: C.onAccent, ...T.body },
    attachPanel: {
      // 2026-11-15：从「输入栏正上方」改到「输入栏下面」——老板看到的是它从聊天框上面冒出来。
      // 现在它是 composerWrap 里的第二块（在输入栏之后），所以天然在下面；
      // 出场/退场只靠 translateY + opacity，不动消息区布局。
      // 圆角按通则收小到 8，底部留白由 insets 现场给。
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: S.x5,
      paddingHorizontal: S.page,
      paddingTop: S.x4,
      backgroundColor: C.card2,
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
      marginHorizontal: S.x4,
      marginBottom: S.x3,
    },
    attachTile: {
      width: 80,
      height: 80,
      borderRadius: 8,
      backgroundColor: C.card,
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.x2,
    },
    attachTileText: { color: C.ink, ...T.meta, fontWeight: '500' },
    tileIconFrame: {
      width: 28,
      height: 24,
      borderRadius: 6,
      borderWidth: 1.5,
      overflow: 'hidden',
      justifyContent: 'flex-end',
    },
    tileIconDot: { position: 'absolute', top: 4, right: 5, width: 5, height: 5, borderRadius: 3 },
    tileIconHill: { height: 7, borderTopLeftRadius: 4, borderTopRightRadius: 4, marginHorizontal: 4 },
    tileIconCamera: {
      width: 30,
      height: 24,
      borderRadius: 6,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tileIconLens: { width: 11, height: 11, borderRadius: 6 },
    tileIconCross: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
    tileIconCrossBar: { position: 'absolute', width: 22, height: 1.5, borderRadius: 1 },
    tileIconCrossBarAlt: { transform: [{ rotate: '90deg' }] },
    attachPillOff: { opacity: 0.5 },
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
