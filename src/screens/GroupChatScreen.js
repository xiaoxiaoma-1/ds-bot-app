import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
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
import { uploadFile } from '../api';

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
  const [err, setErr] = useState(null);
  const [showAttach, setShowAttach] = useState(false);
  const [media, setMedia] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [pendingHint, setPendingHint] = useState('');
  const [showMembers, setShowMembers] = useState(false);

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

  const chooseMedia = useCallback(async (source) => {
    setShowAttach(false);
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.status !== 'granted') {
        setErr({ step: '权限不足', message: '需要相机权限才能拍照' });
        return;
      }
    } else if (source === 'library') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        setErr({ step: '权限不足', message: '需要相册权限才能选择图片' });
        return;
      }
    }

    const options = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
      base64: false,
    };

    let result;
    if (source === 'camera') {
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }

    if (result.canceled || !result.assets || result.assets.length === 0) return;

    const asset = result.assets[0];
    setMedia(prev => [...prev, {
      uri: asset.uri,
      type: asset.type || 'image',
      name: asset.fileName || `image_${Date.now()}.jpg`,
    }]);
  }, []);

  const removeMedia = useCallback((index) => {
    setMedia(prev => prev.filter((_, i) => i !== index));
  }, []);

  const uploadAllMedia = useCallback(async () => {
    if (media.length === 0) return [];
    
    setUploading(true);
    try {
      const uploaded = [];
      for (const item of media) {
        const uploadResult = await uploadFile(item.uri, { type: item.type, name: item.name });
        if (uploadResult.ok) {
          uploaded.push({
            type: item.type,
            path: uploadResult.path,
            cover: item.type === 'video' ? uploadResult.cover : undefined,
          });
        }
      }
      return uploaded;
    } catch (error) {
      setErr({ step: '上传失败', message: error.message });
      return [];
    } finally {
      setUploading(false);
    }
  }, [media]);

  const onSend = useCallback(async () => {
    const text = draft.trim();
    const hasMedia = media.length > 0;
    
    if (!text && !hasMedia) return;
    if (sending || uploading) return;
    
    setErr(null);
    setSending(true);
    setPendingHint('');
    
    // 上传媒体文件
    let mediaArray = [];
    if (hasMedia) {
      mediaArray = await uploadAllMedia();
    }
    
    // 先把自己那句挂上去，别等往返（后端最长 1.2 秒）
    setMsgs((prev) => prev.concat([{
      seq: 'local-' + Date.now(),
      who: 'me',
      whoName: '我',
      text,
      media: mediaArray,
      local: true
    }]));
    
    // 清空输入和媒体
    setDraft('');
    setMedia([]);
    
    try {
      const d = await groupApi.send(id, text, mediaArray.length > 0 ? mediaArray : undefined);
      setMsgs(Array.isArray(d.messages) ? d.messages : []);
      setCursor(d.cursor || null);
      if (d.group) setInfo(d.group);
      if (d.target === 'group' && d.reply) setPendingHint(d.reply);
    } catch (e) {
      setErr(e.message);
      setMsgs((prev) => prev.filter((m) => !m.local)); // 发失败就把那句撤掉，别留假消息
      setDraft(text);
      setMedia(hasMedia ? media : []); // 恢复媒体
    } finally {
      setSending(false);
    }
  }, [draft, sending, uploading, id, media, uploadAllMedia]);

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
            <Text style={mine ? s.bubbleTextMine : s.bubbleTextTheirs} allowFontScaling={false}>
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
        <Pressable onPress={() => setShowMembers(true)} hitSlop={8} accessibilityRole="button">
          <Text style={s.mode} allowFontScaling={false}>
            {(info?.members || []).length} 人
          </Text>
        </Pressable>
      </View>

      {/* 成员列表Modal */}
      <Modal
        visible={showMembers}
        animationType="fade"
        transparent
        onRequestClose={() => setShowMembers(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowMembers(false)}>
          <View style={s.modalContent}>
            <Text style={s.modalTitle} allowFontScaling={false}>
              群里的人
            </Text>
            <FlatList
              data={info?.members || []}
              keyExtractor={(member) => String(member.id)}
              renderItem={({ item }) => (
                <View style={s.memberItem}>
                  <Text style={s.memberName} allowFontScaling={false} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {/* TODO: 后端 member_add/member_remove 接口就绪后开启增删按钮 */}
                </View>
              )}
              style={s.memberList}
              contentContainerStyle={s.memberListContent}
            />
            <Pressable style={s.modalClose} onPress={() => setShowMembers(false)}>
              <Text style={s.modalCloseText} allowFontScaling={false}>
                关闭
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

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

          {/* 媒体预览区域 */}
          {media.length > 0 && (
            <View style={s.mediaPreview}>
              {media.map((item, index) => (
                <View key={index} style={s.mediaItem}>
                  <Text style={s.mediaName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Pressable style={s.mediaRemove} onPress={() => removeMedia(index)}>
                    <Text style={s.mediaRemoveText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {/* 附件选择面板 */}
          {showAttach && (
            <View style={s.attachPanel}>
              <Pressable style={s.attachOption} onPress={() => chooseMedia('camera')}>
                <Text style={s.attachText}>拍照</Text>
              </Pressable>
              <Pressable style={s.attachOption} onPress={() => chooseMedia('library')}>
                <Text style={s.attachText}>从相册选择</Text>
              </Pressable>
              <Pressable style={s.attachCancel} onPress={() => setShowAttach(false)}>
                <Text style={s.attachCancelText}>取消</Text>
              </Pressable>
            </View>
          )}

          <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, S.x3) + S.x2 }]}>
            <Pressable
              style={s.attachBtn}
              onPress={() => setShowAttach(true)}
              disabled={sending || uploading}
            >
              <Text style={s.attachBtnText} allowFontScaling={false}>
                ＋
              </Text>
            </Pressable>
            <View style={s.inputWrapper}>
              <TextInput
                style={s.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="说点什么"
                placeholderTextColor={C.placeholder}
                multiline
                editable={!sending}
                allowFontScaling={false}
                scrollEnabled
              />
            </View>
            <Pressable
              style={[s.sendBtn, (sending || uploading || (!draft.trim() && media.length === 0)) ? s.sendDim : null]}
              onPress={onSend}
              disabled={sending || uploading || (!draft.trim() && media.length === 0)}
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
    body: { flex: 1, paddingBottom: S.x6 },
    head: {
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: S.page,
      gap: S.x3,
    },
    back: { color: C.ink2, ...T.body },
    title: { color: C.ink, ...T.title, flex: 1, textAlign: 'center' },
    mode: { color: C.ink3, ...T.meta, width: 56, textAlign: 'right' },
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
      paddingVertical: S.x3,
    },
    bubbleMine: { backgroundColor: C.me },
    bubbleTheirs: { backgroundColor: C.card },
    bubbleTextMine: { color: C.ink, ...T.body },
    bubbleTextTheirs: { color: C.ink, ...T.body },
    bubbleLocal: { opacity: 0.6 },
    bubbleText: { color: C.ink, ...T.body },
    cut: { color: C.ink3, ...T.meta, marginTop: S.x1 },
    pending: { color: C.ink3, ...T.meta, textAlign: 'center', paddingVertical: S.x3 },
    errLine: { paddingHorizontal: S.page, paddingBottom: S.x2 },
    errText: { color: C.bad, ...T.meta },
    note: { color: C.ink3, ...T.meta, paddingHorizontal: S.page, paddingBottom: S.x2 },
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
      maxHeight: 120,
      backgroundColor: C.card,
      borderRadius: R.capsule,
      overflow: 'hidden',
      paddingVertical: S.x3,
      justifyContent: 'center',
    },
    input: {
      flex: 1,
      width: '100%',
      maxHeight: 120,
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
    sendDim: { opacity: 0.5 },
    sendText: { color: C.onAccent, ...T.body },
    
    // 媒体相关样式
    mediaPreview: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: S.page,
      paddingTop: S.x2,
      gap: S.x2,
    },
    mediaItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: C.card,
      borderRadius: R.small,
      padding: S.x2,
      gap: S.x2,
    },
    mediaName: {
      fontSize: 12,
      color: C.ink,
      maxWidth: 80,
    },
    mediaRemove: {
      width: 18,
      height: 18,
      backgroundColor: C.ink3,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mediaRemoveText: {
      color: C.bg,
      fontSize: 14,
      fontWeight: 'bold',
      lineHeight: 18,
    },
    
    // 附件选择面板样式
    attachPanel: {
      position: 'absolute',
      bottom: '100%',
      left: S.page,
      right: S.page,
      backgroundColor: C.bg,
      borderRadius: R.small,
      padding: S.x2,
      marginBottom: S.x2,
    },
    attachOption: {
      paddingVertical: S.x3,
      paddingHorizontal: S.x4,
      backgroundColor: C.card,
      borderRadius: R.small,
      marginBottom: S.x2,
    },
    attachText: { color: C.ink, ...T.body },
    attachCancel: {
      paddingVertical: S.x3,
      paddingHorizontal: S.x4,
      backgroundColor: C.accent,
      borderRadius: R.small,
    },
    attachCancelText: { color: C.onAccent, ...T.body },
    
    // 加号按钮样式
    attachBtn: {
      width: 40,
      height: 40,
      backgroundColor: C.card,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    attachBtnText: {
      color: C.ink3,
      fontSize: 24,
      fontWeight: 'bold',
      lineHeight: 24,
    },
    
    // 成员列表Modal样式
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: S.page,
    },
    modalContent: {
      backgroundColor: C.bg,
      borderRadius: R.small,
      padding: S.x4,
      width: '100%',
      maxHeight: '80%',
    },
    modalTitle: {
      color: C.ink,
      ...T.title,
      textAlign: 'center',
      marginBottom: S.x4,
    },
    memberList: {
      flexGrow: 0,
      marginBottom: S.x4,
    },
    memberListContent: {
      paddingVertical: S.x2,
    },
    memberItem: {
      paddingVertical: S.x3,
      paddingHorizontal: S.x4,
      borderBottomWidth: 1,
      borderBottomColor: C.hairline,
    },
    memberName: {
      color: C.ink,
      ...T.body,
    },
    modalClose: {
      backgroundColor: C.accent,
      borderRadius: R.capsule,
      paddingVertical: S.x3,
      alignItems: 'center',
    },
    modalCloseText: {
      color: C.onAccent,
      ...T.body,
    },
  });
