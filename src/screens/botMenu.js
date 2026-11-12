import { useMemo, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { avatarInk, useTheme } from '../theme';
import { maskFor } from '../avatarMasks';
import { botApi, COLORS, SHAPE_NAMES } from '../botApi';

// 长按弹出的 Bot 操作菜单：9 项主菜单（二级「更多」留到下一批）。
// 父组件只做三件事：传入被点的那一行、接乐观更新 onPatch、接失败回滚 onFail。
const NAME_MAX = 40;
const ROLE_MAX = 24;

export default function BotMenu({ bot, onClose, onPatch, onFail, onMove }) {
  const { scheme, C, T, S, R } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const [view, setView] = useState('main'); // main | name | role | color | shape | del
  const [draft, setDraft] = useState('');
  const [local, setLocal] = useState(null); // 本地校验错误，不为它发请求
  const [busy, setBusy] = useState(false);

  if (!bot) return null;

  const id = String(bot.id);
  const color = (bot.avatar && bot.avatar.color) || 'deepseek';
  const shape = (bot.avatar && bot.avatar.shape) || 'gumdrop';
  const ink = avatarInk(color, scheme);

  // 统一出口：先乐观更新本地行 → 再发请求 → 失败回滚并交给父组件的顶部横幅
  const run = async (patch, request) => {
    if (busy) return;
    setBusy(true);
    onPatch(patch);
    try {
      await request();
      setBusy(false);
      onClose();
    } catch (e) {
      onFail(e.message, patch);
      setBusy(false);
    }
  };

  const back = () => {
    setLocal(null);
    setView('main');
  };

  const submitText = (field) => {
    const v = draft.trim();
    const max = field === 'name' ? NAME_MAX : ROLE_MAX;
    if (!v) {
      setLocal(field === 'name' ? '名字不能为空' : '角色标签不能为空');
      return;
    }
    if (v.length > max) {
      setLocal('最多 ' + max + ' 个字');
      return;
    }
    setLocal(null);
    const patch = field === 'name' ? { name: v } : { role: v };
    run(patch, () => (field === 'name' ? botApi.rename(id, v) : botApi.role(id, v)));
  };

  const row = (label, onPress, opts) => (
    <Pressable
      key={label}
      style={s.item}
      onPress={onPress}
      disabled={busy || Boolean(opts && opts.disabled)}
    >
      <Text
        style={[
          s.itemText,
          opts && opts.tint ? { color: opts.tint } : null,
          opts && opts.disabled ? { color: C.ink3 } : null,
        ]}
        allowFontScaling={false}
      >
        {label}
      </Text>
      {opts && opts.right ? (
        <Text style={s.itemRight} allowFontScaling={false}>
          {opts.right}
        </Text>
      ) : null}
    </Pressable>
  );

  const head = (title, onBack) => (
    <View style={s.head}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} disabled={busy}>
          <Text style={s.headBack} allowFontScaling={false}>
            返回
          </Text>
        </Pressable>
      ) : (
        <View style={s.headSlot} />
      )}
      <Text style={s.headTitle} numberOfLines={1} allowFontScaling={false}>
        {title}
      </Text>
      <Pressable onPress={onClose} hitSlop={12}>
        <Text style={s.headCancel} allowFontScaling={false}>
          取消
        </Text>
      </Pressable>
    </View>
  );

  const mainBody = (
    <View>
      {row(bot.pinned ? '取消置顶' : '置顶', () => run({ pinned: !bot.pinned }, () => botApi.flags(id, !bot.pinned)))}
      {row(bot.hidden ? '取消隐藏' : '隐藏', () => run({ hidden: !bot.hidden }, () => botApi.hidden(id, !bot.hidden)))}
      {row('标为未读', () => run({ unread: (bot.unread || 0) + 1, hasUnread: true }, () => botApi.markUnread(id)))}
      {row('改名', () => {
        setDraft(bot.name || '');
        setLocal(null);
        setView('name');
      })}
      {row('改角色标签', () => {
        setDraft(bot.role || '');
        setLocal(null);
        setView('role');
      })}
      {row('改颜色', () => setView('color'), { right: color })}
      {row('改形状', () => setView('shape'), { right: shape })}
      {row('移动', () => {
        onMove(bot);
        onClose();
      })}
      {row('删除', () => setView('del'), { tint: C.accentCoral })}
    </View>
  );

  const textBody = (field) => {
    const max = field === 'name' ? NAME_MAX : ROLE_MAX;
    const over = draft.length > max;
    return (
      <View>
        <TextInput
          style={s.input}
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            if (local) setLocal(null);
          }}
          autoFocus
          placeholder={field === 'name' ? '给这个 Bot 起个名字' : '一句话说明它负责什么'}
          placeholderTextColor={C.ink3}
          returnKeyType="done"
          onSubmitEditing={() => submitText(field)}
          editable={!busy}
          allowFontScaling={false}
        />
        <View style={s.inputMeta}>
          <Text style={[s.metaText, local ? { color: C.accentCoral } : null]} allowFontScaling={false}>
            {local || (field === 'name' ? '名字最多 40 个字' : '角色标签最多 24 个字')}
          </Text>
          <Text style={[s.metaText, over ? { color: C.accentCoral } : null]} allowFontScaling={false}>
            {draft.length + '/' + max}
          </Text>
        </View>
        <Pressable style={[s.primary, busy ? s.dim : null]} onPress={() => submitText(field)} disabled={busy}>
          <Text style={s.primaryText} allowFontScaling={false}>
            保存
          </Text>
        </Pressable>
      </View>
    );
  };

  const colorBody = (
    <View style={s.grid}>
      {COLORS.map((c) => {
        const bg = avatarInk(c, scheme);
        const on = c === color;
        return (
          <Pressable
            key={c}
            style={s.cell}
            disabled={busy}
            onPress={() => run({ avatar: { ...bot.avatar, color: c } }, () => botApi.color(id, c))}
          >
            <View style={[s.dot, { backgroundColor: bg }, on ? s.dotOn : null]}>
              {on ? <View style={s.dotInner} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );

  const shapeBody = (
    <View style={s.grid}>
      {SHAPE_NAMES.map((n) => {
        const on = n === shape;
        return (
          <Pressable
            key={n}
            style={s.cell}
            disabled={busy}
            onPress={() => run({ avatar: { ...bot.avatar, shape: n } }, () => botApi.shape(id, n))}
          >
            <View style={[s.shapeBox, on ? { backgroundColor: C.card2 } : null]}>
              <Image
                source={{ uri: maskFor(n) }}
                style={[s.shapeImg, { tintColor: ink }]}
                resizeMode="contain"
                fadeDuration={0}
              />
            </View>
          </Pressable>
        );
      })}
    </View>
  );

  const delBody = (
    <View>
      <Text style={s.delTitle} allowFontScaling={false}>
        标记删除
      </Text>
      <Text style={s.delText} allowFontScaling={false}>
        这个 Bot 的全部对话历史在手机上不再显示。
      </Text>
      <Text style={s.delText} allowFontScaling={false}>
        可在「已隐藏」里恢复。
      </Text>
      <Pressable
        style={[s.primary, s.danger, busy ? s.dim : null]}
        disabled={busy}
        onPress={() => run({ deleted: true }, () => botApi.remove(id))}
      >
        <Text style={s.dangerText} allowFontScaling={false}>
          标记删除
        </Text>
      </Pressable>
    </View>
  );

  const titles = { main: '操作', name: '改名', role: '改角色标签', color: '改颜色', shape: '改形状', del: '标记删除' };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none">
          <Pressable style={s.sheet} onPress={() => {}}>
            {head(titles[view], view === 'main' ? null : back)}
            {view === 'main' ? mainBody : null}
            {view === 'name' ? textBody('name') : null}
            {view === 'role' ? textBody('role') : null}
            {view === 'color' ? colorBody : null}
            {view === 'shape' ? shapeBody : null}
            {view === 'del' ? delBody : null}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (C, T, S, R) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: C.card,
      borderTopLeftRadius: R.big,
      borderTopRightRadius: R.big,
      paddingHorizontal: S.page,
      paddingTop: S.x4,
      paddingBottom: S.x6,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: S.x3,
      minHeight: 22,
    },
    headSlot: { width: 32 },
    headTitle: { color: C.ink, ...T.title, flex: 1, textAlign: 'center' },
    headBack: { color: C.ink2, ...T.body, width: 32 },
    headCancel: { color: C.ink2, ...T.body, width: 32, textAlign: 'right' },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 48,
    },
    itemText: { color: C.ink, ...T.title },
    itemRight: { color: C.ink3, ...T.body },
    input: {
      backgroundColor: C.card2,
      borderRadius: R.small,
      paddingHorizontal: S.x4,
      paddingVertical: S.x3,
      color: C.ink,
      ...T.title,
      minHeight: 48,
    },
    inputMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: S.x2, paddingHorizontal: S.x1 },
    metaText: { color: C.ink3, ...T.meta },
    primary: {
      marginTop: S.x4,
      backgroundColor: C.accent,
      borderRadius: R.capsule,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { color: C.onAccent, ...T.title },
    dim: { opacity: 0.5 },
    danger: { backgroundColor: 'transparent' },
    dangerText: { color: C.accentCoral, ...T.title },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: { width: '20%', height: 72, alignItems: 'center', justifyContent: 'center' },
    dot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    dotOn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.card2 },
    dotInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.ink },
    shapeBox: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    shapeImg: { width: 44, height: 44 },
    delTitle: { color: C.ink, ...T.section, marginBottom: S.x3 },
    delText: { color: C.ink2, ...T.body, marginBottom: S.x1 },
  });
