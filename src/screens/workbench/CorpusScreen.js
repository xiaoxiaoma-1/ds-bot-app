import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';

// 我的语料库 · 骨架版（2026-11-12）
// 总经理定：**这一版只做骨架** —— 列表 + 搜索框 + 空态 + 说明文案。
// 导出与详情「留空位」：本文件里不出现，不画死入口（点了没反应比没有更糟）。
//
// 与「我的观点」的关系：**同一张表 my_views、同一个接口 /views/list**，但语义不同 ——
// 我的观点 = 我写下的判断；语料库 = 我说过的原话（只出不进，不进稿库、不被拆解）。
// 两屏保持独立，不合并（总经理 2026-11-12 定，理由：电脑端就是两个入口）。
//
// 数据源：GET /api/dsh-media/views/list?limit=120&q=  → { ok, total, views:[{id,kind,title,content,chars,created_at}] }
// 搜索：后端 content like ? or title like ?；电脑端防抖 400ms，本页沿用
// 真实量级（直读 workbench.db 2026-11-12）：2 条 / 440 字 —— 所以先骨架，别为 2 条数据做满屏功能
//
// props
//   rows      [{ id, kind, title, content, chars, created_at }]
//   onQuery(kw)  搜索词变化（已防抖）；kw 为空串表示清空
//   onRefresh()
//   onBack / activeTab / onTabPress

const SHAPE_H = 196;
const DEBOUNCE = 400;

const DEFAULT_ROWS = [
  {
    id: 'mv_1794102193_raw',
    kind: '原话',
    title: '年轻的时候不认真搞钱，你可能活不到能享受的那天（原话）',
    content:
      '其实我觉得年轻的时候如果说你不去搞钱，你不去认认真真搞钱，不要听信那些所谓的什么「我很年轻的时候就是拿来享受」。不然的话，你老了之后，你再去想想要去享受，你会发现好多你年轻的时候想要的东西，其实你根本就没有办法享受到了。',
    chars: 373,
    created_at: '2026-11-08 09:43:13',
  },
  {
    id: 'mv_1794154164321',
    kind: '自写',
    title: '嗯那个我觉得吧，普通人想赚钱其实最关键的不是找什…',
    content: '嗯那个我觉得吧，普通人想赚钱其实最关键的不是找什么好项目，而是先把自己能干的活儿干到别人离不开你，因为你没有资源的时候只能靠手艺换机会',
    chars: 67,
    created_at: '2026-11-09 00:09:24',
  },
];

export default function CorpusScreen({
  rows = DEFAULT_ROWS,
  onQuery,
  onRefresh,
  onBack,
  error = null, // 有值就盖在空态之上：先让用户看到「加载失败」，不是「没数据」
  onRetry,
  activeTab = 'workbench',
  onTabPress,
}) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);

  const [q, setQ] = useState('');
  const timer = useRef(null);

  // 防抖 400ms（跟电脑端一致）
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (onQuery) onQuery(q.trim());
    }, DEBOUNCE);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, onQuery]);

  const total = rows.length;

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: onTabPress ? dockPadding(insets, S) : S.page + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <View style={s.shape} />
          <Pressable style={[s.back, { top: insets.top }]} onPress={onBack} accessibilityRole="button" accessibilityLabel="返回">
            <Text style={s.backText} allowFontScaling={false}>
              ‹
            </Text>
          </Pressable>
          <View style={[s.headText, { top: insets.top + S.x6 * 2 + S.x1 }]}>
            <Text style={s.title} allowFontScaling={false}>
              我的语料库
            </Text>
            <Text style={s.subTitle} numberOfLines={1} allowFontScaling={false}>
              {total} 条 · 私有
            </Text>
          </View>
        </View>

        {/* 说明：只出不进 */}
        <Text style={s.intro} allowFontScaling={false}>
          这是你自己的话，只出不进：不进稿库、不被当成素材、不参与任何拆分
        </Text>

        {/* 搜索 */}
        <TextInput
          style={s.search}
          value={q}
          onChangeText={setQ}
          placeholder="搜你说过的话…"
          placeholderTextColor={C.ink3}
          returnKeyType="search"
          allowFontScaling={false}
        />

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText} allowFontScaling={false}>
              {error}
            </Text>
            {onRetry ? (
              <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button">
                <Text style={s.retryText} allowFontScaling={false}>
                  重试
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : total === 0 ? (
          <Text style={s.empty} allowFontScaling={false}>
            {q.trim() ? '没搜到这条。' : '语料库还是空的。去「我的观点」写第一条。'}
          </Text>
        ) : (
          rows.map((v) => (
            <View key={v.id} style={s.card}>
              <View style={s.cardTop}>
                <Text style={s.cardTitle} numberOfLines={2} allowFontScaling={false}>
                  {v.title || '（无标题）'}
                </Text>
                <Text style={s.cardChars} allowFontScaling={false}>
                  {v.chars || 0} 字
                </Text>
              </View>
              <Text style={s.cardBody} numberOfLines={2} allowFontScaling={false}>
                {String(v.content || '').replace(/\n/g, ' ').slice(0, 90)}
              </Text>
            </View>
          ))
        )}

        {/* 空位：导出文档、点开详情 —— 这一版不做，不画入口 */}
      </ScrollView>

      {onTabPress ? <Dock activeTab={activeTab} onTabPress={onTabPress} /> : null}
    </View>
  );
}

const makeStyles = (C, T, S, R, K) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },

    top: { position: 'relative' },
    shape: {
      height: SHAPE_H,
      marginHorizontal: -S.page,
      backgroundColor: K.brand,
      borderBottomLeftRadius: R.big * 2,
      borderBottomRightRadius: R.big * 2,
    },
    back: {
      position: 'absolute',
      left: 14,
      width: 44,
      height: 44,
      borderRadius: R.capsule,
      backgroundColor: K.edge,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backText: { color: C.ink, ...T.title, marginTop: -2 },
    headText: { position: 'absolute', left: S.page, right: S.page },
    title: { color: K.onBrand, ...T.display },
    subTitle: { marginTop: S.x1, color: K.onBrand, opacity: 0.78, ...T.meta, fontWeight: '500' },

    intro: { marginTop: S.x4, marginHorizontal: S.page, color: C.ink2, ...T.meta },
    search: {
      marginTop: S.x3,
      marginHorizontal: S.page,
      height: 44,
      borderRadius: R.capsule,
      backgroundColor: C.card,
      paddingHorizontal: S.x4,
      color: C.ink,
      ...T.body,
    },

    card: { marginTop: S.x3, marginHorizontal: S.page, backgroundColor: C.card, borderRadius: R.small, padding: S.x4 },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: S.x2 },
    cardTitle: { flex: 1, color: C.ink, ...T.title },
    cardChars: { color: C.ink3, ...T.meta },
    cardBody: { marginTop: S.x2, color: C.ink2, ...T.meta },

    empty: { marginTop: S.x6, marginHorizontal: S.page, color: C.ink2, ...T.body },
    errorBox: {
      marginTop: S.x6,
      marginHorizontal: S.page,
      backgroundColor: C.card,
      borderRadius: R.small,
      padding: S.x4,
      gap: S.x2,
    },
    errorText: { color: C.bad, ...T.body },
    retryText: { color: K.brand, ...T.meta, fontWeight: '500' },
  });
