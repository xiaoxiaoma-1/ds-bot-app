import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { groupUnreadLabel } from '../groups';

// 群组底部的「最后一条」是「名字：内容」，全角「：」和半角「:」都出现过。
// 切出来：名字做发言人标签，其余当预览正文；切不动（没有冒号、冒号在最前、名字不像名字）
// 就整条当正文，绝不把「名字：」原样留在预览里，也不把半截名字当标签。
function splitPreview(raw) {
  const s = String(raw || '');
  const i = s.search(/[：:]/);
  if (i <= 0) return { who: '', text: s };
  const who = s.slice(0, i).trim();
  const rest = s.slice(i + 1).trim();
  if (!who) return { who: '', text: s };
  if (!rest) return { who: '', text: '' }; // 只有「名字：」没有正文，退回人数那行
  if (who.length > 12 || /\s/.test(who)) return { who: '', text: s };
  return { who, text: rest.replace(/^\*+\s*/, '') };
}


// 顾问列表底部的「群组」区：与 bot 分成两个区，不混在一条列表里。
// 未读按群计，一个群 N 个成员说话也只算这个群 1 条（数字来自后端 groups[].unread，>9 写 9+）。
export default function GroupSection({ groups, note, names, onOpen }) {
  const { C, T, S, R } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  if (!groups || groups.length === 0) return null;

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.title} allowFontScaling={false}>
          群组
        </Text>
        <Text style={s.count} allowFontScaling={false}>
          {groups.length} 个
        </Text>
      </View>
      {note ? (
        <Text style={s.note} allowFontScaling={false}>
          {note}
        </Text>
      ) : null}
      {groups.map((g) => {
        const badge = groupUnreadLabel(g);
        // admin 是成员里的 bot id，不是名字；拿不到名字就退回人数，不显示一串 session-xxx
        const spoken = splitPreview(g.preview);
        const adminName = g.admin ? names && names[String(g.admin)] : null;
        const meta = [`${g.memberCount} 人`];
        if (adminName) meta.push(`牵头 ${adminName}`);
        if (g.mode === 'admin') meta.push('只有牵头发言');
        return (
          <Pressable key={g.id} style={s.row} onPress={() => onOpen(g)} disabled={!onOpen}>
            <View style={s.mark}>
              <Text style={s.markText} allowFontScaling={false}>
                群
              </Text>
            </View>
            <View style={s.body}>
              <Text style={s.name} numberOfLines={1} allowFontScaling={false}>
                {g.name}
              </Text>
              <Text style={s.preview} numberOfLines={1} allowFontScaling={false}>
                {spoken.who ? <Text style={s.speaker}>{spoken.who}：</Text> : null}
                {spoken.text || meta.join(' · ')}
              </Text>
            </View>
            {badge ? (
              <View style={s.badge}>
                <Text style={s.badgeText} allowFontScaling={false}>
                  {badge}
                </Text>
              </View>
            ) : (
              <Text style={s.meta} allowFontScaling={false}>
                {g.memberCount} 人
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (C, T, S, R) =>
  StyleSheet.create({
    wrap: { paddingHorizontal: S.page, paddingTop: S.section },
    head: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: S.x2,
    },
    title: { color: C.ink, ...T.section },
    count: { color: C.ink3, ...T.meta },
    note: { color: C.ink3, ...T.meta, marginBottom: S.x3 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 76,
      gap: S.x3,
    },
    mark: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: C.brandHi,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markText: { color: C.ink, ...T.body, fontWeight: '600' },
    body: { flex: 1, gap: S.x1 },
    name: { color: C.ink, ...T.title },
    preview: { color: C.ink2, ...T.meta },
    speaker: { color: C.ink, ...T.meta, fontWeight: '600' },
    meta: { color: C.ink3, ...T.meta },
    badge: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.accentCoral,
    },
    badgeText: { color: C.onAccent, ...T.meta, fontWeight: '600' },
  });
