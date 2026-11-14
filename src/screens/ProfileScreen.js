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

function nameFor(asset, kind, index) {
  if (asset && asset.fileName) return asset.fileName;
  const ext = kind === 'video' ? 'mp4' : 'jpg';
  return `${kind}-${Date.now()}-${index}.${ext}`;
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

  const [me, setMe] = useState({ nickname: '', avatarUrl: '', signature: '' });
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [moments, setMoments] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showMoments, setShowMoments] = useState(false);
  const [viewer, setViewer] = useState(null);

  const [showComposer, setShowComposer] = useState(false);
  const [postText, setPostText] = useState('');
  const [draftMedia, setDraftMedia] = useState([]);
  const [posting, setPosting] = useState(false);
  const [postingText, setPostingText] = useState('');

  const loadMomentsPage = useCallback(async (reset) => {
    const offset = reset ? 0 : moments.length;
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const items = await fetchMoments(PAGE_SIZE, offset);
      const normalized = await Promise.all(items.map(normalizeMoment));
      setMoments((prev) => (reset ? normalized : [...prev, ...normalized]));
      setHasMore(items.length === PAGE_SIZE);
      if (reset) setShowMoments(true);
      setErr(null);
    } catch (e) {
      setErr({ step: '朋友圈加载失败', message: e.message || '未知错误' });
    } finally {
      if (reset) setLoading(false);
      else setLoadingMore(false);
    }
  }, [moments.length]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [profile, items] = await Promise.all([fetchMe(), fetchMoments(PAGE_SIZE, 0)]);
        setMe({ ...profile, avatarUrl: await toFullUrl(profile.avatarUrl) });
        const normalized = await Promise.all(items.map(normalizeMoment));
        setMoments(normalized);
        setHasMore(items.length === PAGE_SIZE);
        setErr(null);
      } catch (e) {
        setErr({ step: '我的页面加载失败', message: e.message || '未知错误' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const goBack = useCallback(() => {
    if (onBack) onBack();
    else if (navigation && navigation.goBack) navigation.goBack();
  }, [navigation, onBack]);

  const openSettings = useCallback(() => {
    if (onOpenSettings) onOpenSettings();
    else if (navigation && navigation.navigate) navigation.navigate('Setup');
  }, [navigation, onOpenSettings]);

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
      setMe((prev) => ({ ...prev, [field]: next }));
      setEditing(null);
      setErr(null);
    } catch (e) {
      setErr({ step: '保存失败', message: e.message || '未知错误' });
    } finally {
      setSaving(false);
    }
  };

  const pickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setErr({ step: '权限不足', message: '需要相册权限才能选择头像' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;
    const uri = result.assets[0].uri;
    setSaving(true);
    try {
      const { path, url } = await uploadImage(uri);
      await updateMe({ avatar_path: path });
      const fullUrl = await toFullUrl(url || path);
      setMe((prev) => ({ ...prev, avatarUrl: fullUrl }));
      setErr(null);
    } catch (e) {
      setErr({ step: '换头像失败', message: e.message || '未知错误' });
    } finally {
      setSaving(false);
    }
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
      name: nameFor(asset, 'image', i),
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
      name: nameFor(asset, 'video', i),
      path: '',
      cover: '',
    }));
    setDraftMedia((prev) => [...prev, ...picked].slice(0, MEDIA_LIMIT));
  };

  const removeDraftMedia = (id) => {
    setDraftMedia((prev) => prev.filter((m) => m.id !== id));
  };

  const submitMoment = async () => {
    const text = postText.trim();
    if (posting || (!text && draftMedia.length === 0)) return;
    setPosting(true);
    setPostingText('准备上传');
    try {
      const media = [];
      for (let i = 0; i < draftMedia.length; i += 1) {
        const item = draftMedia[i];
        setPostingText(`正在上传 ${i + 1}/${draftMedia.length}`);
        let path = item.path;
        if (!path) {
          const up = await uploadFile(item.uri, {
            type: item.type,
            name: item.name,
            timeoutMs: item.kind === 'video' ? 180000 : 60000,
          });
          path = up.path;
        }
        const mediaItem = { type: item.kind, path };
        if (item.cover) mediaItem.cover = item.cover;
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
            <Pressable onPress={pickAvatar} disabled={saving} style={s.avatarWrap}>
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
