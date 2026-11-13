import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
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
import { fetchMe, updateMe, uploadImage, fetchMoments, postMoment } from '../api';
import { getBase } from '../store';

const AVATAR_SIZE = 120;
const AVATAR_PLACEHOLDER = '😃';

async function toFullUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  const base = await getBase();
  return `${String(base).replace(/\/$/, '')}${u.startsWith('/') ? u : '/' + u}`;
}

export default function ProfileScreen({ navigation }) {
  const { C, T, S, R } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();

  // 个人资料
  const [me, setMe] = useState({ nickname: '', avatarUrl: '', signature: '' });
  const [editing, setEditing] = useState(null); // 'nickname' | 'signature'
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // 朋友圈
  const [moments, setMoments] = useState([]);
  const [posting, setPosting] = useState(false);
  const [postText, setPostText] = useState('');
  const [showPostModal, setShowPostModal] = useState(false);

  // 加载个人资料和朋友圈
  useEffect(() => {
    (async () => {
      try {
        const [profile, items] = await Promise.all([
          fetchMe(),
          fetchMoments(),
        ]);
        // avatar_url 是相对路径，需要转成完整 URL
        const meData = {
          ...profile,
          avatarUrl: profile.avatar_url ? await toFullUrl(profile.avatar_url) : '',
        };
        setMe(meData);
        // 朋友圈的图片也要转换
        const momentsWithFullUrls = await Promise.all(
          items.map(async (item) => ({
            ...item,
            imageUrl: item.image_url ? await toFullUrl(item.image_url) : '',
          }))
        );
        setMoments(momentsWithFullUrls);
      } catch (e) {
        setErr({ step: '加载失败', message: e.message || '未知错误' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 保存字段
  const saveField = async (field) => {
    if (!draft.trim() || saving) return;
    if (draft.trim() === me[field]) {
      setEditing(null);
      return;
    }
    setSaving(true);
    try {
      const patch = field === 'nickname' ? { nickname: draft.trim() } : { signature: draft.trim() };
      await updateMe(patch);
      setMe({ ...me, [field]: draft.trim() });
      setEditing(null);
    } catch (e) {
      setErr({ step: '保存失败', message: e.message || '未知错误' });
    } finally {
      setSaving(false);
    }
  };

  // 挑选头像
  const pickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setErr({ step: '权限不足', message: '需要相册权限才能选择头像' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
      // url 是相对路径，需要转成完整 URL
      const fullUrl = await toFullUrl(url);
      setMe({ ...me, avatarUrl: fullUrl });
    } catch (e) {
      setErr({ step: '换头像失败', message: e.message || '未知错误' });
    } finally {
      setSaving(false);
    }
  };

  // 发朋友圈
  const submitMoment = async () => {
    if (!postText.trim() || posting) return;
    setPosting(true);
    try {
      await postMoment(postText.trim());
      setMoments([{ id: Date.now(), text: postText.trim(), at: new Date().toISOString() }, ...moments]);
      setPostText('');
      setShowPostModal(false);
    } catch (e) {
      setErr({ step: '发朋友圈失败', message: e.message || '未知错误' });
    } finally {
      setPosting(false);
    }
  };

  // 渲染字段编辑行
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
          />
          <Pressable
            style={[s.smallBtn, saving && s.smallBtnBusy]}
            onPress={() => saveField(field)}
            disabled={saving}
          >
            {saving ? <ActivityIndicator size="small" color={C.onHero} /> : <Text style={s.smallBtnText}>保存</Text>}
          </Pressable>
          <Pressable
            style={[s.smallBtn, s.smallBtnGhost]}
            onPress={() => {
              setEditing(null);
              setDraft(value);
            }}
            disabled={saving}
          >
            <Text style={s.smallBtnGhostText}>取消</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={s.fieldRow}>
        <Text style={s.fieldValue} allowFontScaling={false}>
          {value || `还没有${label}`}
        </Text>
        <Pressable
          style={[s.smallBtn, s.smallBtnGhost]}
          onPress={() => {
            setEditing(field);
            setDraft(value);
          }}
        >
          <Text style={s.smallBtnGhostText}>改{label}</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* 标题栏 */}
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={s.back} allowFontScaling={false}>‹ 返回</Text>
        </Pressable>
        <Text style={s.title} allowFontScaling={false}>个人主页</Text>
        <View style={{ width: 40 }} />
      </View>

      {err ? (
        <View style={s.errBox}>
          <Text style={s.errTitle} allowFontScaling={false}>{err.step}</Text>
          <Text style={s.errMsg} allowFontScaling={false}>{err.message}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.ink} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: S.x6 }} keyboardShouldPersistTaps="handled">
          {/* 头像 */}
          <View style={s.avatarSection}>
            <Pressable onPress={pickAvatar} disabled={saving}>
              <View style={s.avatarWrap}>
                {me.avatarUrl ? (
                  <Image
                    source={{ uri: me.avatarUrl }}
                    style={s.avatar}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[s.avatar, { backgroundColor: C.card }]}>
                    <Text style={s.avatarPlaceholder} allowFontScaling={false}>
                      {AVATAR_PLACEHOLDER}
                    </Text>
                  </View>
                )}
                {saving && (
                  <View style={s.avatarOverlay}>
                    <ActivityIndicator color={C.onHero} />
                  </View>
                )}
              </View>
            </Pressable>
            <Text style={s.avatarHint} allowFontScaling={false}>点我换头像</Text>
          </View>

          {/* 昵称 */}
          <Text style={s.label} allowFontScaling={false}>昵称（最多 40 字）</Text>
          {renderFieldRow('昵称', 'nickname', 40)}

          {/* 签名 */}
          <Text style={[s.label, { marginTop: S.x4 }]} allowFontScaling={false}>签名（最多 60 字）</Text>
          {renderFieldRow('签名', 'signature', 60)}

          {/* 朋友圈标题 */}
          <View style={s.momentHeader}>
            <Text style={s.momentTitle} allowFontScaling={false}>朋友圈</Text>
            <Pressable
              style={[s.smallBtn, s.smallBtnGhost]}
              onPress={() => setShowPostModal(true)}
            >
              <Text style={s.smallBtnGhostText}>＋</Text>
            </Pressable>
          </View>

          {/* 朋友圈列表 */}
          {moments.length === 0 ? (
            <Text style={s.emptyMoments} allowFontScaling={false}>
              还没有动态，点 + 发一条
            </Text>
          ) : (
            moments.map((item) => (
              <View key={item.id} style={s.momentItem}>
                <Text style={s.momentText} allowFontScaling={false}>
                  {item.text}
                </Text>
                <Text style={s.momentTime} allowFontScaling={false}>
                  {new Date(item.at).toLocaleString('zh-CN')}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* 发朋友圈模态框 */}
      <Modal visible={showPostModal} transparent animationType="slide">
        <View style={s.modalBackdrop}>
          <View style={s.modalContent}>
            <Text style={s.modalTitle} allowFontScaling={false}>发朋友圈</Text>
            <TextInput
              style={s.modalInput}
              value={postText}
              onChangeText={setPostText}
              multiline
              maxLength={200}
              placeholder="写点什么…"
              placeholderTextColor={C.placeholder}
            />
            <View style={s.modalActions}>
              <Pressable
                style={[s.smallBtn, s.smallBtnGhost]}
                onPress={() => setShowPostModal(false)}
                disabled={posting}
              >
                <Text style={s.smallBtnGhostText}>取消</Text>
              </Pressable>
              <Pressable
                style={[s.smallBtn, posting && s.smallBtnBusy]}
                onPress={submitMoment}
                disabled={posting || !postText.trim()}
              >
                {posting ? (
                  <ActivityIndicator size="small" color={C.onHero} />
                ) : (
                  <Text style={s.smallBtnText}>发送</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (C, T, S, R) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: S.page,
      paddingVertical: S.x4,
      borderBottomWidth: 1,
      borderBottomColor: C.card2,
    },
    back: { color: C.ink2, ...T.body },
    title: { color: C.ink, ...T.title },
    errBox: {
      margin: S.page,
      padding: S.x4,
      backgroundColor: C.card,
      borderRadius: R.small,
      gap: S.x1,
    },
    errTitle: { color: C.bad, ...T.title },
    errMsg: { color: C.ink2, ...T.body },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    avatarSection: { alignItems: 'center', marginVertical: S.x6 },
    avatarWrap: { position: 'relative' },
    avatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
    },
    avatarPlaceholder: { fontSize: 60, textAlign: 'center', lineHeight: AVATAR_SIZE },
    avatarOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.3)',
      borderRadius: AVATAR_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarHint: { color: C.ink2, ...T.meta, marginTop: S.x2 },
    label: { color: C.ink2, ...T.meta, marginTop: S.x4, marginHorizontal: S.page },
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: S.page,
      marginTop: S.x2,
      gap: S.x2,
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
    momentHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: S.x6,
      marginHorizontal: S.page,
    },
    momentTitle: { color: C.ink, ...T.title },
    emptyMoments: {
      color: C.ink3,
      ...T.body,
      textAlign: 'center',
      marginTop: S.x4,
      marginHorizontal: S.page,
    },
    momentItem: {
      backgroundColor: C.card,
      borderRadius: R.small,
      padding: S.x4,
      marginHorizontal: S.page,
      marginTop: S.x2,
    },
    momentText: { color: C.ink, ...T.body },
    momentTime: { color: C.ink3, ...T.meta, marginTop: S.x1 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: C.bg,
      borderTopLeftRadius: R.small,
      borderTopRightRadius: R.small,
      padding: S.x6,
    },
    modalTitle: { color: C.ink, ...T.title, marginBottom: S.x4 },
    modalInput: {
      backgroundColor: C.card,
      borderRadius: R.small,
      color: C.ink,
      ...T.body,
      padding: S.x4,
      minHeight: 100,
      textAlignVertical: 'top',
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: S.x2,
      marginTop: S.x4,
    },
  });