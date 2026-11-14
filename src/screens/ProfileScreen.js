import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
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
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  fetchMe,
  updateMe,
  uploadImage,
  uploadFile,
  fetchMoments,
  postMoment,
} from '../api';
import { getBase } from '../store';
import { setCached, useCachedResource } from '../cache';

const AVATAR_SIZE = 104;
const MEDIA_LIMIT = 9;
const PAGE_SIZE = 20;

async function toFullUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  const base = await getBase();
  return `${String(base).replace(/\/$/, '')}${u.startsWith('/') ? u : '/' + u}`;
}

async function normalizeMoment(item) {
  const rawMedia = Array.isArray(item.media) ? item.media : [];
  const media = await Promise.all(
    rawMedia.map(async (m) => ({
      type: m.type === 'video' ? 'video' : 'image',
      url: await toFullUrl(m.url),
      coverUrl: m.cover_url ? await toFullUrl(m.cover_url) : '',
    })),
  );
  // 兼容旧接口：只有一个 image_url 时也把它当成一张图。
  if (media.length === 0 && item.image_url) {
    media.push({ type: 'image', url: await toFullUrl(item.image_url), coverUrl: '' });
  }
  return { ...item, media };
}

function mediaLabel(m) {
  if (!m) return '';
  return m.type === 'video' ? '视频' : '图片';
}

function formatAt(at) {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return String(at);
  return d.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mimeFor(asset, kind) {
  if (asset && asset.mimeType) return asset.mimeType;
  const uri = String((asset && asset.uri) || '').toLowerCase();
  if (kind === 'video') return uri.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
  if (uri.endsWith('.png')) return 'image/png';
  if (uri.endsWith('.webp')) return 'image/webp';
  if (uri.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function withExtension(name, kind) {
  const value = String(name || '').trim();
  if (/\.[a-z0-9]{2,5}$/i.test(value)) return value;
  return `${value || kind}.${kind === 'video' ? 'mp4' : 'jpg'}`;
}

function isUploadPath(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return Boolean(v) && !/^[a-z][a-z0-9+.-]*:/i.test(v) && !v.includes('/') && !v.includes('\\');
}

function nameFor(asset, kind) {
  if (asset && asset.fileName) return asset.fileName;
  return kind === 'video' ? 'video.mp4' : 'photo.jpg';
}

function errorHttpStatus(e) {
  if (!e) return null;
  const direct = e.status || e.httpStatus || e.statusCode;
  if (direct !== undefined && direct !== null && Number.isFinite(Number(direct))) {
    return Number(direct);
  }
  const hit = /(?:HTTP|状态码)\s*(\d{3})/i.exec(String(e.message || ''));
  return hit ? Number(hit[1]) : null;
}

function failureFor(step, e, fallback) {
  const status = errorHttpStatus(e);
  return {
    step: status ? `${step}（HTTP ${status}）：` : `${step}：`,
    message: (e && e.message) || fallback || '未知错误',
  };
}

function VideoThumb({ uri, style, s }) {
  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
    p.loop = false;
  });
  return <VideoView player={player} style={style} contentFit="cover" nativeControls={false} />;
}

function VideoViewer({ uri, C, T, S, R, insets }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <VideoView
      player={player}
      style={{ flex: 1, marginTop: insets.top + S.x6, marginBottom: insets.bottom + S.x6 }}
      contentFit="contain"
      nativeControls
    />
  );
}

export default function ProfileScreen({ navigation, onBack, embedded = false, onOpenSettings }) {
  const { C, T, S, R } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();
  const cachedProfile = useCachedResource('me:profile', fetchMe);
  const cachedMoments = useCachedResource('me:moments:first', () => fetchMoments(PAGE_SIZE, 0));

  const [me, setMe] = useState(() => ({
    nickname: cachedProfile.data?.nickname || '',
    avatarUrl: /^https?:\/\//i.test(String(cachedProfile.data?.avatarUrl || ''))
      ? cachedProfile.data.avatarUrl
      : '',
    signature: cachedProfile.data?.signature || '',
  }));
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(() => !cachedProfile.data);
  const [err, setErr] = useState(null);

  const [moments, setMoments] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showMoments, setShowMoments] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);

  const [showComposer, setShowComposer] = useState(false);
  const [postText, setPostText] = useState('');
  const [draftMedia, setDraftMedia] = useState([]);
  const [posting, setPosting] = useState(false);
  const [postingText, setPostingText] = useState('');

  const loadMomentsPage = useCallback(async (reset) => {
    const offset = reset ? 0 : moments.length;
    // 只让朋友圈自己转圈，不把已经加载好的个人资料整页清空。
    setLoadingMore(true);
    try {
      const items = await fetchMoments(PAGE_SIZE, offset);
      const normalized = await Promise.all(items.map(normalizeMoment));
      setMoments((prev) => (reset ? normalized : [...prev, ...normalized]));
      setHasMore(items.length === PAGE_SIZE);
      if (reset) {
        setShowMoments(true);
        setCached('me:moments:first', items);
      }
      setErr(null);
    } catch (e) {
      setErr({ step: '朋友圈加载失败', message: e.message || '未知错误' });
    } finally {
      setLoadingMore(false);
    }
  }, [moments.length]);

  useEffect(() => {
    let alive = true;
    if (!cachedProfile.data) return undefined;
    (async () => {
      const profile = cachedProfile.data;
      const avatarUrl = await toFullUrl(profile.avatarUrl);
      if (!alive) return;
      setMe({
        nickname: profile.nickname || '',
        avatarUrl,
        signature: profile.signature || '',
      });
      setLoading(false);
      setErr(null);
    })();
    return () => { alive = false; };
  }, [cachedProfile.data]);

  useEffect(() => {
    let alive = true;
    if (!cachedMoments.data) return undefined;
    (async () => {
      const normalized = await Promise.all(cachedMoments.data.map(normalizeMoment));
      if (!alive) return;
      setMoments(normalized);
      setHasMore(cachedMoments.data.length === PAGE_SIZE);
    })();
    return () => { alive = false; };
  }, [cachedMoments.data]);

  useEffect(() => {
    if (!cachedProfile.data && cachedProfile.error) {
      setErr({ step: '我的页面加载失败', message: cachedProfile.error });
      setLoading(false);
    }
    if (!cachedMoments.data && cachedMoments.error) {
      setErr({ step: '朋友圈加载失败', message: cachedMoments.error });
    }
  }, [cachedProfile.data, cachedProfile.error, cachedMoments.data, cachedMoments.error]);

  const goBack = useCallback(() => {
    if (onBack) onBack();
    else if (navigation && navigation.goBack) navigation.goBack();
  }, [navigation, onBack]);

  const openSettings = useCallback(() => {
    if (onOpenSettings) onOpenSettings();
    else if (navigation && navigation.navigate) navigation.navigate('Setup');
  }, [navigation, onOpenSettings]);

  const rememberProfile = (next) => {
    setCached('me:profile', {
      nickname: next.nickname || '',
      avatarUrl: next.avatarUrl || '',
      signature: next.signature || '',
    });
  };

  const saveField = async (field) => {
    const next = draft.trim();
    if (field === 'nickname' && !next) return;
    if (saving) return;
    if (next === (me[field] || '')) {
      setEditing(null);
      return;
    }
    setSaving(true);
    try {
      const patch = field === 'nickname' ? { nickname: next } : { signature: next };
      await updateMe(patch);
      const nextMe = { ...me, [field]: next };
      setMe(nextMe);
      rememberProfile(nextMe);
      setEditing(null);
      setErr(null);
    } catch (e) {
      setErr({ step: '保存失败', message: e.message || '未知错误' });
    } finally {
      setSaving(false);
    }
  };

  const applyAvatar = async (uri) => {
    if (!uri || saving) return;
    setSaving(true);
    try {
      const { path, url } = await uploadImage(uri);
      await updateMe({ avatar_path: path });
      const fullUrl = await toFullUrl(url || path);
      const nextMe = { ...me, avatarUrl: fullUrl };
      setMe(nextMe);
      rememberProfile(nextMe);
      setErr(null);
    } catch (e) {
      setErr(failureFor('换头像失败', e));
    } finally {
      setSaving(false);
    }
  };

  const chooseAvatar = async (source) => {
    setShowAvatarMenu(false);
    if (saving) return;
    if (source === 'view') {
      if (!me.avatarUrl) {
        setErr({ step: '看大图失败', message: '还没有头像，先拍一张或从相册选一张' });
        return;
      }
      setViewer({ type: 'image', url: me.avatarUrl });
      return;
    }

    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      setErr({
        step: '权限不足',
        message: source === 'camera' ? '需要相机权限才能拍头像' : '需要相册权限才能选择头像',
      });
      return;
    }

    const options = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets || !result.assets[0]) return;
    await applyAvatar(result.assets[0].uri);
  };

  const pickImages = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setErr({ step: '权限不足', message: '需要相册权限才能添加图片' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MEDIA_LIMIT,
      quality: 0.8,
    });
    if (result.canceled) return;
    const picked = (result.assets || []).map((asset, i) => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'image',
      uri: asset.uri,
      type: mimeFor(asset, 'image'),
      name: nameFor(asset, 'image'),
      path: '',
      cover: '',
    }));
    setDraftMedia((prev) => [...prev, ...picked].slice(0, MEDIA_LIMIT));
  };

  const pickVideo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setErr({ step: '权限不足', message: '需要相册权限才能添加视频' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: true,
      selectionLimit: MEDIA_LIMIT,
      quality: 1,
    });
    if (result.canceled) return;
    const picked = (result.assets || []).map((asset, i) => ({
      id: `${Date.now()}-v-${i}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'video',
      uri: asset.uri,
      type: mimeFor(asset, 'video'),
      name: nameFor(asset, 'video'),
      path: '',
      cover: '',
    }));
    setDraftMedia((prev) => [...prev, ...picked].slice(0, MEDIA_LIMIT));
  };

  const pickCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setErr({ step: '权限不足', message: '需要相机权限才能拍照' });
      return;
    }
    // 录视频时 iOS 还要麦克风权限；拒绝也不影响拍照，所以只做一次静默申请。
    try {
      await ImagePicker.requestMicrophonePermissionsAsync();
    } catch (e) {
      // 没有麦克风权限时仍可拍照，忽略。
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
      videoMaxDuration: 60,
    });
    if (result.canceled) return;
    const picked = (result.assets || []).map((asset, i) => {
      const kind = asset.type === 'video' || /^video\//.test(String(asset.mimeType || ''))
        ? 'video'
        : 'image';
      return {
        id: `${Date.now()}-c-${i}-${Math.random().toString(36).slice(2, 6)}`,
        kind,
        uri: asset.uri,
        type: mimeFor(asset, kind),
        name: nameFor(asset, kind),
        path: '',
        cover: '',
      };
    });
    setDraftMedia((prev) => [...prev, ...picked].slice(0, MEDIA_LIMIT));
  };

  const pickCover = async (id) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setErr({ step: '权限不足', message: '需要相册权限才能选封面' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 0.8,
    });
    if (result.canceled || !result.assets || !result.assets[0]) return;
    const asset = result.assets[0];
    try {
      setPostingText('正在上传封面');
      const up = await uploadFile(asset.uri, {
        type: mimeFor(asset, 'image'),
        name: withExtension(asset.fileName || 'cover.jpg', 'image'),
        timeoutMs: 60000,
      });
      const coverPath = String(up.path || '').trim();
      if (!coverPath) throw new Error('封面上传成功但没有返回文件名');
      setDraftMedia((prev) => prev.map((m) => (
        m.id === id ? { ...m, cover: coverPath, coverName: asset.fileName || '' } : m
      )));
      setErr(null);
    } catch (e) {
      setErr({ step: '封面上传失败', message: e.message || '未知错误' });
    } finally {
      setPostingText('');
    }
  };

  const removeDraftMedia = (id) => {
    setDraftMedia((prev) => prev.filter((m) => m.id !== id));
  };

  const submitMoment = async () => {
    const text = postText.trim();
    if (posting || (!text && draftMedia.length === 0)) return;
    if (draftMedia.some((m) => m.kind === 'video' && !isUploadPath(m.cover))) {
      setErr({ step: '发朋友圈失败', message: '视频需要先选封面再发布' });
      return;
    }
    setPosting(true);
    setPostingText('准备上传');
    try {
      const media = [];
      for (let i = 0; i < draftMedia.length; i += 1) {
        const item = draftMedia[i];
        const kind = item.kind === 'video' ? 'video' : 'image';
        setPostingText(`正在上传 ${i + 1}/${draftMedia.length}`);

        // 只认 upload 返回的文件名；本地 uri / 完整 url 都不能直接进 media.path。
        let path = isUploadPath(item.path) ? item.path.trim() : '';
        if (!path) {
          const uploadType = kind === 'video'
            ? (/^video\//.test(item.type || '') ? item.type : 'video/mp4')
            : (/^image\//.test(item.type || '') ? item.type : 'image/jpeg');
          const up = await uploadFile(item.uri, {
            type: uploadType,
            name: withExtension(item.name, kind),
            timeoutMs: kind === 'video' ? 180000 : 60000,
          });
          path = String(up.path || '').trim();
          if (!path) throw new Error('上传成功但没有返回文件名');
        }

        const mediaItem = { type: kind, path };
        // 视频封面必须同样是 upload 返回的 path；本地 uri 先补传。
        let cover = isUploadPath(item.cover) ? item.cover.trim() : '';
        if (kind === 'video' && !cover && item.cover) {
          const coverUp = await uploadFile(item.cover, {
            type: 'image/jpeg',
            name: withExtension(item.coverName || 'cover.jpg', 'image'),
            timeoutMs: 60000,
          });
          cover = String(coverUp.path || '').trim();
        }
        if (kind === 'video' && cover) mediaItem.cover = cover;
        media.push(mediaItem);
      }
      setPostingText('正在发布');
      await postMoment(text, media);
      setPostText('');
      setDraftMedia([]);
      setShowComposer(false);
      await loadMomentsPage(true);
      setShowMoments(true);
      setErr(null);
    } catch (e) {
      setErr({ step: '发朋友圈失败', message: e.message || '未知错误，草稿已保留' });
    } finally {
      setPosting(false);
      setPostingText('');
    }
  };

  const renderFieldRow = (label, field, maxLength) => {
    const value = me[field] || '';
    if (editing === field) {
      return (
        <View style={s.fieldRow}>
          <TextInput
            style={s.fieldInput}
            value={draft}
            onChangeText={setDraft}
            maxLength={maxLength}
            autoFocus
            placeholder={`请输入${label}`}
            placeholderTextColor={C.placeholder}
            autoComplete="off"
            textContentType="none"
          />
          <Pressable
            style={[s.smallBtn, saving && s.smallBtnBusy]}
            onPress={() => saveField(field)}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={C.onHero} />
            ) : (
              <Text style={s.smallBtnText} allowFontScaling={false}>保存</Text>
            )}
          </Pressable>
          <Pressable
            style={[s.smallBtn, s.smallBtnGhost]}
            onPress={() => {
              setEditing(null);
              setDraft(value);
            }}
            disabled={saving}
          >
            <Text style={s.smallBtnGhostText} allowFontScaling={false}>取消</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={s.fieldRow}>
        <Text style={s.fieldValue} numberOfLines={2} allowFontScaling={false}>
          {value || `还没有${label}`}
        </Text>
        <Pressable
          style={[s.smallBtn, s.smallBtnGhost]}
          onPress={() => {
            setEditing(field);
            setDraft(value);
          }}
        >
          <Text style={s.smallBtnGhostText} allowFontScaling={false}>改{label}</Text>
        </Pressable>
      </View>
    );
  };

  const latest = moments[0] || null;
  const imageCount = moments.reduce(
    (n, m) => n + (m.media || []).filter((x) => x.type === 'image').length,
    0,
  );
  const videoCount = moments.reduce(
    (n, m) => n + (m.media || []).filter((x) => x.type === 'video').length,
    0,
  );
  const bubbleSummary = [
    `${moments.length} 条记录`,
    imageCount ? `${imageCount} 张` : '',
    videoCount ? `${videoCount} 个视频` : '',
  ].filter(Boolean).join(' · ');

  return (
    <View style={[s.root, { paddingTop: embedded ? insets.top + S.x2 : insets.top }]}>
      <View style={s.header}>
        {!embedded ? (
          <Pressable onPress={goBack} hitSlop={12} style={s.backHit}>
            <Text style={s.back} allowFontScaling={false}>‹ 返回</Text>
          </Pressable>
        ) : (
          <Text style={s.title} allowFontScaling={false}>我的</Text>
        )}
        {!embedded ? (
          <Text style={s.title} allowFontScaling={false}>个人主页</Text>
        ) : null}
        <Pressable onPress={openSettings} hitSlop={12} style={s.serverLink}>
          <Text style={s.serverText} allowFontScaling={false}>服务器</Text>
        </Pressable>
      </View>

      {err ? (
        <View style={s.errBox}>
          <Text style={s.errTitle} allowFontScaling={false}>{err.step}</Text>
          <Text style={s.errMsg} allowFontScaling={false}>{err.message}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.accent} size="large" />
          <Text style={s.loadingText} allowFontScaling={false}>正在取我的资料</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + S.x6 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.profileBlock}>
            <Pressable
              onPress={() => setShowAvatarMenu(true)}
              disabled={saving}
              style={s.avatarWrap}
              hitSlop={8}
            >
              {me.avatarUrl ? (
                <Image source={{ uri: me.avatarUrl }} style={s.avatar} resizeMode="cover" />
              ) : (
                <View style={[s.avatar, { backgroundColor: C.card2 }]}>
                  <Text style={s.avatarPlaceholder} allowFontScaling={false}>＋</Text>
                </View>
              )}
              {saving ? (
                <View style={s.avatarOverlay}>
                  <ActivityIndicator color={C.onHero} />
                </View>
              ) : null}
            </Pressable>
            <Text style={s.nickname} allowFontScaling={false}>
              {me.nickname || '还没有昵称'}
            </Text>
            <Text style={s.signature} allowFontScaling={false}>
              {me.signature || '还没有签名'}
            </Text>
            <Text style={s.avatarHint} allowFontScaling={false}>点头像可以更换</Text>
          </View>

          <View style={s.profileFields}>
            <Text style={s.profileTitle} allowFontScaling={false}>个人资料</Text>
            <Text style={s.label} allowFontScaling={false}>昵称（最多 40 字）</Text>
            {renderFieldRow('昵称', 'nickname', 40)}
            <Text style={s.label} allowFontScaling={false}>签名（最多 60 字）</Text>
            {renderFieldRow('签名', 'signature', 60)}
          </View>

          <Pressable
            style={s.momentBubble}
            onPress={() => {
              setShowMoments(true);
              if (moments.length === 0) loadMomentsPage(true);
            }}
          >
            <View style={s.bubbleTop}>
              <View style={s.bubbleFlag}>
                <Text style={s.bubbleFlagText} allowFontScaling={false}>朋友圈</Text>
              </View>
              <Text style={s.bubbleSummary} allowFontScaling={false}>{bubbleSummary}</Text>
            </View>
            {latest ? (
              <>
                <Text style={s.bubbleText} numberOfLines={2} allowFontScaling={false}>
                  {latest.text || '分享了一段内容'}
                </Text>
                {(latest.media || []).length > 0 ? (
                  <View style={s.bubbleMediaRow}>
                    {(latest.media || []).slice(0, 3).map((m, i) => (
                      <View key={i} style={s.bubbleMediaItem}>
                        {m.type === 'video' ? (
                          m.coverUrl ? (
                            <Image source={{ uri: m.coverUrl }} style={s.bubbleImage} resizeMode="cover" />
                          ) : (
                            <View style={[s.bubbleImage, s.mediaFallback]}>
                              <Text style={s.mediaFallbackText} allowFontScaling={false}>视频</Text>
                            </View>
                          )
                        ) : (
                          <Image source={{ uri: m.url }} style={s.bubbleImage} resizeMode="cover" />
                        )}
                      </View>
                    ))}
                    {(latest.media || []).length > 3 ? (
                      <View style={[s.bubbleImage, s.mediaMore]}>
                        <Text style={s.mediaMoreText} allowFontScaling={false}>
                          +{(latest.media || []).length - 3}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
                <Text style={s.bubbleOpen} allowFontScaling={false}>点开看全部 ›</Text>
              </>
            ) : (
              <Text style={s.bubbleEmpty} allowFontScaling={false}>还没有动态，点开写一条</Text>
            )}
          </Pressable>

          <Pressable style={s.serverRow} onPress={openSettings}>
            <Text style={s.serverRowTitle} allowFontScaling={false}>服务器设置</Text>
            <Text style={s.serverRowHint} allowFontScaling={false}>地址、口令、退出登录 ›</Text>
          </Pressable>
        </ScrollView>
      )}

      <Modal
        visible={showAvatarMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAvatarMenu(false)}
      >
        <View style={s.sheetBackdrop}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + S.x4 }]}>
            <Text style={s.sheetTitle} allowFontScaling={false}>更换头像</Text>
            <Pressable
              style={s.menuItem}
              onPress={() => chooseAvatar('camera')}
              disabled={saving}
            >
              <Text style={s.menuItemText} allowFontScaling={false}>拍照</Text>
            </Pressable>
            <Pressable
              style={s.menuItem}
              onPress={() => chooseAvatar('library')}
              disabled={saving}
            >
              <Text style={s.menuItemText} allowFontScaling={false}>从相册选</Text>
            </Pressable>
            <Pressable
              style={[s.menuItem, !me.avatarUrl && s.menuItemDisabled]}
              onPress={() => chooseAvatar('view')}
              disabled={!me.avatarUrl || saving}
            >
              <Text style={s.menuItemText} allowFontScaling={false}>看大图</Text>
            </Pressable>
            <Pressable
              style={[s.menuItem, s.menuCancel]}
              onPress={() => setShowAvatarMenu(false)}
            >
              <Text style={s.menuCancelText} allowFontScaling={false}>取消</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showMoments}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMoments(false)}
      >
        <View style={s.sheetBackdrop}>
          <View style={[s.sheet, { height: '86%' }]}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle} allowFontScaling={false}>朋友圈</Text>
              <Pressable onPress={() => setShowMoments(false)} hitSlop={12}>
                <Text style={s.sheetClose} allowFontScaling={false}>关闭</Text>
              </Pressable>
            </View>
            <View style={s.sheetToolbar}>
              <Text style={s.sheetCount} allowFontScaling={false}>{bubbleSummary}</Text>
              <Pressable
                style={s.writeBtn}
                onPress={() => {
                  setShowMoments(false);
                  setShowComposer(true);
                }}
              >
                <Text style={s.writeBtnText} allowFontScaling={false}>＋ 写一条</Text>
              </Pressable>
            </View>
            <ScrollView
              style={s.sheetBody}
              contentContainerStyle={{ paddingBottom: insets.bottom + S.x6 }}
              keyboardShouldPersistTaps="handled"
              onScroll={(e) => {
                const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                if (
                  hasMore &&
                  !loadingMore &&
                  contentOffset.y + layoutMeasurement.height >= contentSize.height - 40
                ) {
                  loadMomentsPage(false);
                }
              }}
              scrollEventThrottle={16}
            >
              {moments.length === 0 ? (
                <Text style={s.emptyMoments} allowFontScaling={false}>还没有动态，点右上角写一条</Text>
              ) : (
                moments.map((item) => (
                  <View key={item.id} style={s.momentCard}>
                    <Text style={s.momentText} allowFontScaling={false}>{item.text}</Text>
                    <Text style={s.momentTime} allowFontScaling={false}>{formatAt(item.at)}</Text>
                    {(item.media || []).length > 0 ? (
                      <View style={s.momentMediaGrid}>
                        {(item.media || []).map((m, i) => (
                          <Pressable
                            key={i}
                            style={s.momentMediaCell}
                            onPress={() => setViewer(m)}
                          >
                            {m.type === 'video' ? (
                              m.coverUrl ? (
                                <Image source={{ uri: m.coverUrl }} style={s.momentMedia} resizeMode="cover" />
                              ) : (
                                <VideoThumb uri={m.url} style={s.momentMedia} s={s} />
                              )
                            ) : (
                              <Image source={{ uri: m.url }} style={s.momentMedia} resizeMode="cover" />
                            )}
                            {m.type === 'video' ? (
                              <View style={s.videoBadge}>
                                <Text style={s.videoBadgeText} allowFontScaling={false}>视频</Text>
                              </View>
                            ) : null}
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ))
              )}
              {loadingMore ? (
                <View style={s.moreRow}>
                  <ActivityIndicator color={C.accent} />
                  <Text style={s.moreText} allowFontScaling={false}>正在取更多</Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showComposer}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!posting) setShowComposer(false);
        }}
      >
        <KeyboardAvoidingView
          style={s.sheetBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[s.composer, { paddingBottom: insets.bottom + S.x4 }]}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle} allowFontScaling={false}>写一条</Text>
              <Pressable
                onPress={() => {
                  if (!posting) setShowComposer(false);
                }}
                hitSlop={12}
              >
                <Text style={s.sheetClose} allowFontScaling={false}>关闭</Text>
              </Pressable>
            </View>
            <TextInput
              style={s.composerInput}
              value={postText}
              onChangeText={setPostText}
              multiline
              maxLength={200}
              placeholder="这一刻的想法…"
              placeholderTextColor={C.placeholder}
              autoComplete="off"
              textContentType="none"
            />
            {draftMedia.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.draftRow}>
                {draftMedia.map((m) => (
                  <View key={m.id} style={s.draftItem}>
                    {m.kind === 'video' ? (
                      <VideoThumb uri={m.uri} style={s.draftImage} s={s} />
                    ) : (
                      <Image source={{ uri: m.uri }} style={s.draftImage} resizeMode="cover" />
                    )}
                    {m.kind === 'video' ? (
                      <Pressable
                        style={s.coverBtn}
                        onPress={() => pickCover(m.id)}
                        disabled={posting}
                      >
                        <Text style={s.coverBtnText} allowFontScaling={false}>
                          {m.cover ? '换封面' : '选封面'}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      style={s.removeMedia}
                      onPress={() => removeDraftMedia(m.id)}
                      disabled={posting}
                    >
                      <Text style={s.removeMediaText} allowFontScaling={false}>×</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            ) : null}
            <View style={s.composerActions}>
              <Pressable style={s.addBtn} onPress={pickCamera} disabled={posting}>
                <Text style={s.addBtnText} allowFontScaling={false}>拍照</Text>
              </Pressable>
              <Pressable style={s.addBtn} onPress={pickImages} disabled={posting}>
                <Text style={s.addBtnText} allowFontScaling={false}>加图片</Text>
              </Pressable>
              <Pressable style={s.addBtn} onPress={pickVideo} disabled={posting}>
                <Text style={s.addBtnText} allowFontScaling={false}>加视频</Text>
              </Pressable>
              <Pressable
                style={[s.publishBtn, (posting || (!postText.trim() && !draftMedia.length)) && s.publishBtnBusy]}
                onPress={submitMoment}
                disabled={posting || (!postText.trim() && !draftMedia.length)}
              >
                {posting ? (
                  <ActivityIndicator size="small" color={C.onHero} />
                ) : (
                  <Text style={s.publishBtnText} allowFontScaling={false}>发布</Text>
                )}
              </Pressable>
            </View>
            {posting && postingText ? (
              <Text style={s.postingText} allowFontScaling={false}>{postingText}</Text>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!viewer}
        transparent
        animationType="fade"
        onRequestClose={() => setViewer(null)}
      >
        <View style={s.viewerBackdrop}>
          <Pressable style={s.viewerClose} onPress={() => setViewer(null)} hitSlop={12}>
            <Text style={s.viewerCloseText} allowFontScaling={false}>关闭</Text>
          </Pressable>
          {viewer && viewer.type === 'video' ? (
            <VideoViewer uri={viewer.url} C={C} T={T} S={S} R={R} insets={insets} />
          ) : viewer ? (
            <Image source={{ uri: viewer.url }} style={s.viewerImage} resizeMode="contain" />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (C, T, S, R) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    header: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: S.page,
      paddingVertical: S.x2,
    },
    backHit: { paddingVertical: S.x1, paddingRight: S.x2 },
    back: { color: C.ink2, ...T.body },
    title: { color: C.ink, ...T.section },
    serverLink: { paddingVertical: S.x1 },
    serverText: { color: C.accent, ...T.meta },
    errBox: {
      marginHorizontal: S.page,
      marginBottom: S.x2,
      padding: S.x4,
      backgroundColor: C.card,
      borderRadius: R.small,
      gap: S.x1,
    },
    errTitle: { color: C.bad, ...T.title },
    errMsg: { color: C.ink2, ...T.body },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: S.x3 },
    loadingText: { color: C.ink3, ...T.meta },
    profileBlock: { alignItems: 'center', paddingHorizontal: S.page, paddingTop: S.x4 },
    avatarWrap: { position: 'relative' },
    avatar: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: R.capsule },
    avatarPlaceholder: {
      color: C.ink3,
      fontSize: 34,
      lineHeight: AVATAR_SIZE,
      textAlign: 'center',
    },
    avatarOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: C.scrim,
      borderRadius: R.capsule,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarHint: { color: C.ink3, ...T.meta, marginTop: S.x2 },
    nickname: { color: C.ink, ...T.section, marginTop: S.x3 },
    signature: { color: C.ink2, ...T.body, marginTop: S.x1, textAlign: 'center' },
    profileFields: { paddingHorizontal: S.page, paddingTop: S.x4 },
    profileTitle: { color: C.ink, ...T.section, marginBottom: S.x2 },
    label: { color: C.ink3, ...T.meta, marginTop: S.x3, marginBottom: S.x1 },
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.x2,
      paddingVertical: S.x2,
    },
    fieldInput: {
      flex: 1,
      backgroundColor: C.card,
      borderRadius: R.small,
      color: C.ink,
      ...T.title,
      paddingHorizontal: S.x4,
      paddingVertical: S.x3,
    },
    fieldValue: { flex: 1, color: C.ink, ...T.title },
    smallBtn: {
      backgroundColor: C.hero,
      borderRadius: R.capsule,
      paddingHorizontal: S.x4,
      paddingVertical: S.x2,
      alignItems: 'center',
    },
    smallBtnBusy: { opacity: 0.7 },
    smallBtnText: { color: C.onHero, ...T.meta },
    smallBtnGhost: { backgroundColor: 'transparent' },
    smallBtnGhostText: { color: C.ink2, ...T.meta },
    momentBubble: {
      marginHorizontal: S.page,
      marginTop: S.x4,
      padding: S.x4,
      backgroundColor: C.card,
      borderRadius: R.big,
    },
    bubbleTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    bubbleFlag: {
      backgroundColor: C.brandHi,
      borderRadius: R.capsule,
      paddingHorizontal: S.x3,
      paddingVertical: S.x1,
    },
    bubbleFlagText: { color: C.onAccent, ...T.meta },
    bubbleSummary: { color: C.ink3, ...T.meta },
    bubbleText: { color: C.ink, ...T.body, marginTop: S.x3 },
    bubbleMediaRow: { flexDirection: 'row', gap: S.x2, marginTop: S.x3 },
    bubbleMediaItem: { width: 56, height: 56, borderRadius: R.small, overflow: 'hidden' },
    bubbleImage: { width: 56, height: 56, borderRadius: R.small, backgroundColor: C.card2 },
    mediaFallback: { alignItems: 'center', justifyContent: 'center' },
    mediaFallbackText: { color: C.ink3, ...T.meta },
    mediaMore: { alignItems: 'center', justifyContent: 'center' },
    mediaMoreText: { color: C.ink2, ...T.meta },
    bubbleOpen: { color: C.accent, ...T.meta, marginTop: S.x3 },
    bubbleEmpty: { color: C.ink3, ...T.body, marginTop: S.x3 },
    serverRow: {
      marginHorizontal: S.page,
      marginTop: S.x4,
      paddingHorizontal: S.x4,
      paddingVertical: S.x4,
      backgroundColor: C.card,
      borderRadius: R.small,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    serverRowTitle: { color: C.ink, ...T.body },
    serverRowHint: { color: C.ink3, ...T.meta },
    sheetBackdrop: { flex: 1, backgroundColor: C.scrim, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: C.bg,
      borderTopLeftRadius: R.big,
      borderTopRightRadius: R.big,
      paddingHorizontal: S.page,
      paddingTop: S.x4,
    },
    sheetHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: S.x3,
    },
    sheetTitle: { color: C.ink, ...T.section },
    menuItem: {
      minHeight: 52,
      justifyContent: 'center',
      paddingHorizontal: S.x2,
    },
    menuItemDisabled: { opacity: 0.4 },
    menuItemText: { color: C.ink, ...T.body },
    menuCancel: { marginTop: S.x2, backgroundColor: C.card, borderRadius: R.capsule, alignItems: 'center' },
    menuCancelText: { color: C.ink2, ...T.body },
    sheetClose: { color: C.ink2, ...T.body },
    sheetToolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: S.x3,
    },
    sheetCount: { color: C.ink3, ...T.meta },
    writeBtn: {
      backgroundColor: C.hero,
      borderRadius: R.capsule,
      paddingHorizontal: S.x4,
      paddingVertical: S.x2,
    },
    writeBtnText: { color: C.onHero, ...T.meta },
    sheetBody: { flex: 1 },
    emptyMoments: { color: C.ink3, ...T.body, textAlign: 'center', marginTop: S.x6 },
    momentCard: {
      backgroundColor: C.card,
      borderRadius: R.small,
      padding: S.x4,
      marginBottom: S.x3,
    },
    momentText: { color: C.ink, ...T.body },
    momentTime: { color: C.ink3, ...T.meta, marginTop: S.x1 },
    momentMediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.x2, marginTop: S.x3 },
    momentMediaCell: { width: '31%', aspectRatio: 1, borderRadius: R.small, overflow: 'hidden' },
    momentMedia: { width: '100%', height: '100%', backgroundColor: C.card2 },
    videoBadge: {
      position: 'absolute',
      left: S.x2,
      bottom: S.x2,
      backgroundColor: C.scrim,
      borderRadius: R.capsule,
      paddingHorizontal: S.x2,
      paddingVertical: 2,
    },
    videoBadgeText: { color: C.ink, ...T.meta },
    moreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.x2, paddingVertical: S.x4 },
    moreText: { color: C.ink3, ...T.meta },
    composer: {
      backgroundColor: C.bg,
      borderTopLeftRadius: R.big,
      borderTopRightRadius: R.big,
      paddingHorizontal: S.page,
      paddingTop: S.x4,
    },
    composerInput: {
      minHeight: 100,
      backgroundColor: C.card,
      borderRadius: R.small,
      color: C.ink,
      ...T.body,
      padding: S.x4,
      textAlignVertical: 'top',
    },
    draftRow: { marginTop: S.x3 },
    draftItem: { width: 72, height: 72, marginRight: S.x2, borderRadius: R.small, overflow: 'hidden' },
    draftImage: { width: 72, height: 72, backgroundColor: C.card2 },
    removeMedia: {
      position: 'absolute',
      right: 4,
      top: 4,
      width: 20,
      height: 20,
      borderRadius: R.capsule,
      backgroundColor: C.scrim,
      alignItems: 'center',
      justifyContent: 'center',
    },
    removeMediaText: { color: C.ink, fontSize: 15, lineHeight: 18 },
    coverBtn: {
      position: 'absolute',
      left: 4,
      bottom: 4,
      minHeight: 18,
      paddingHorizontal: S.x2,
      borderRadius: R.capsule,
      backgroundColor: C.scrim,
      alignItems: 'center',
      justifyContent: 'center',
    },
    coverBtnText: { color: C.onAccent, ...T.meta, lineHeight: 18 },
    composerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.x2,
      marginTop: S.x4,
    },
    addBtn: {
      backgroundColor: C.card,
      borderRadius: R.capsule,
      paddingHorizontal: S.x4,
      paddingVertical: S.x2,
    },
    addBtnText: { color: C.ink2, ...T.meta },
    publishBtn: {
      marginLeft: 'auto',
      backgroundColor: C.hero,
      borderRadius: R.capsule,
      paddingHorizontal: S.x5,
      paddingVertical: S.x2,
      minWidth: 72,
      alignItems: 'center',
    },
    publishBtnBusy: { opacity: 0.5 },
    publishBtnText: { color: C.onHero, ...T.meta },
    postingText: { color: C.ink3, ...T.meta, marginTop: S.x2, textAlign: 'right' },
    viewerBackdrop: { flex: 1, backgroundColor: C.bg, justifyContent: 'center' },
    viewerClose: { position: 'absolute', top: 48, right: S.page, zIndex: 20 },
    viewerCloseText: { color: C.ink, ...T.body },
    viewerImage: { width: '100%', height: '80%' },
  });
