import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';

// 书库首页（2026-11-12）
// 总经理已批：① 翻页用纵向连续滚动（番茄默认形态）② 保留 全部/精读/翻翻/跳过 三筛 + 搜索（**400ms 防抖**，
// 桌面端每敲一个字查一次是它的毛病，不照抄）③ 一次拉 10 块、剩 3 块补。
//
// 真实数据（直读 workbench.db）：803 本；verdict 分布 精读 184 / 翻翻 613 / 跳过 6；
//   进度表 book_progress(book_id, chunk_idx, total)。
// 接口：GET /api/dsh-media/sp/books?limit=120&verdict=&q=  → {items, stat, total}
//       GET /api/dsh-media/book/progress/all → {items:[{bookId, chunkIdx, total, updatedAt}]}
//
// 性能硬要求（总经理点名）：803 张卡不许一次渲染 —— FlatList + getItemLayout 定高 + windowSize 限窗。
//
// props
//   books   [{ id, title, gist, verdict }]
//   prog    { [bookId]: { chunkIdx, total } }
//   stat    { 精读:184, 翻翻:613, 跳过:6 }
//   verdict 当前筛选（'' = 全部）
//   onFilter(v) / onQuery(kw)（已防抖）/ onOpenBook(book) / onBack / activeTab / onTabPress

const SHAPE_H = 196;
const ROW_H = 112;
const DEBOUNCE = 400;
const VERDICTS = ['', '精读', '翻翻', '跳过'];

const DEFAULT_STAT = { 精读: 184, 翻翻: 613, 跳过: 6 };

const DEFAULT_BOOKS = [
  { id: 'book_51980f58fc', title: '毛选·矛盾论', gist: '讲矛盾的普遍性与特殊性，为什么抓主要矛盾。', verdict: '精读' },
  { id: 'book_764647617721', title: '系统思考与辩证法的核心', gist: '把变化的原因讲成结构与关系，而不是意志。', verdict: '精读' },
  { id: 'book_88a1', title: '强关系没用，弱关系有用', gist: '机会来自弱连接，不是熟人圈。', verdict: '翻翻' },
  { id: 'book_c02f', title: '某本 OCR 失败的旧书', gist: '正文提取不完整，先跳过。', verdict: '跳过' },
];

const DEFAULT_PROG = { book_51980f58fc: { chunkIdx: 160, total: 260 }, book_88a1: { chunkIdx: 15, total: 215 } };

export default function BooksScreen({
  books = DEFAULT_BOOKS,
  prog = DEFAULT_PROG,
  stat = DEFAULT_STAT,
  verdict = '',
  onFilter,
  onQuery,
  error = null, // 有值就盖在空态之上：先让用户看到「加载失败」，不是「没数据」
  onRetry,
  onOpenBook,
  onBack,
  activeTab = 'workbench',
  onTabPress,
}) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);

  const [q, setQ] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onQuery && onQuery(q.trim()), DEBOUNCE);
    return () => timer.current && clearTimeout(timer.current);
  }, [q, onQuery]);

  const getItemLayout = useMemo(
    () => (_, index) => ({ length: ROW_H, offset: ROW_H * index, index }),
    [],
  );

  const renderRow = ({ item }) => {
    const p = prog[item.id];
    const pct = p && p.total ? Math.min(100, Math.round(((p.chunkIdx + 1) / p.total) * 100)) : 0;
    return (
      <Pressable style={s.row} onPress={() => onOpenBook && onOpenBook(item)} accessibilityRole="button" accessibilityLabel={item.title}>
        <View style={s.rowTop}>
          <Text style={s.rowTitle} numberOfLines={1} allowFontScaling={false}>
            {item.title}
          </Text>
          <View style={[s.badge, { borderColor: vColor(item.verdict, C, K) }]}>
            <Text style={[s.badgeText, { color: vColor(item.verdict, C, K) }]} allowFontScaling={false}>
              {item.verdict || '未评'}
            </Text>
          </View>
        </View>
        <Text style={s.rowGist} numberOfLines={2} allowFontScaling={false}>
          {item.gist || ''}
        </Text>
        {pct > 0 ? (
          <View style={s.progWrap}>
            <View style={s.progTrack}>
              <View style={[s.progFill, { width: pct + '%' }]} />
            </View>
            <Text style={s.progText} allowFontScaling={false}>
              读到 {pct}% · 第 {p.chunkIdx + 1}/{p.total} 块
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={s.root}>
      <View style={s.top}>
        <View style={s.shape} />
        <Pressable style={[s.back, { top: insets.top }]} onPress={onBack} accessibilityRole="button" accessibilityLabel="返回">
          <Text style={s.backText} allowFontScaling={false}>
            ‹
          </Text>
        </Pressable>
        <View style={[s.headText, { top: insets.top + S.x6 * 2 + S.x1 }]}>
          <Text style={s.title} allowFontScaling={false}>
            书库
          </Text>
          <Text style={s.subTitle} numberOfLines={1} allowFontScaling={false}>
            {books.length} 本 · 精读 {stat['精读'] || 0} · 翻翻 {stat['翻翻'] || 0}
          </Text>
        </View>
      </View>

      <View style={s.controls}>
        <TextInput
          style={s.search}
          value={q}
          onChangeText={setQ}
          placeholder="搜书名或一句话概括"
          placeholderTextColor={C.ink3}
          returnKeyType="search"
          allowFontScaling={false}
        />
        <View style={s.chips}>
          {VERDICTS.map((v) => {
            const on = verdict === v;
            return (
              <Pressable key={v || 'all'} style={[s.chip, on ? s.chipOn : null]} onPress={() => onFilter && onFilter(v)} accessibilityRole="button">
                <Text style={[s.chipText, on ? s.chipTextOn : null]} allowFontScaling={false}>
                  {v || '全部'}
                  {stat[v] != null ? ` ${stat[v]}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

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
      ) : books.length === 0 ? (
        <Text style={s.empty} allowFontScaling={false}>
          {q.trim() ? '没搜到这本书。' : '书库还是空的。'}
        </Text>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(it) => it.id}
          renderItem={renderRow}
          getItemLayout={getItemLayout}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={{ paddingTop: S.x3, paddingBottom: onTabPress ? dockPadding(insets, S) : S.x3 + insets.bottom }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {onTabPress ? <Dock activeTab={activeTab} onTabPress={onTabPress} /> : null}
    </View>
  );
}

function vColor(verdict, C, K) {
  if (verdict === '精读') return C.good;
  if (verdict === '翻翻') return K.brand;
  if (verdict === '跳过') return C.ink3;
  return C.ink2;
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

    controls: { marginTop: S.x4, marginHorizontal: S.page },
    search: { height: 44, borderRadius: R.capsule, backgroundColor: C.card, paddingHorizontal: S.x4, color: C.ink, ...T.body },
    chips: { flexDirection: 'row', gap: S.x2, marginTop: S.x3 },
    chip: { height: 32, paddingHorizontal: S.x3, borderRadius: R.capsule, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
    chipOn: { backgroundColor: K.brand },
    chipText: { color: C.ink2, ...T.meta },
    chipTextOn: { color: K.onBrand, fontWeight: '500' },

    row: {
      height: ROW_H,
      marginHorizontal: S.page,
      marginBottom: S.x3 - 4,
      backgroundColor: C.card,
      borderRadius: R.small,
      padding: S.x4,
    },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: S.x2 },
    rowTitle: { flex: 1, color: C.ink, ...T.title },
    badge: { height: 20, paddingHorizontal: S.x2, borderRadius: R.capsule, borderWidth: 0, alignItems: 'center', justifyContent: 'center' },
    badgeText: { ...T.meta },
    rowGist: { marginTop: S.x1, color: C.ink2, ...T.meta, lineHeight: 18 },
    progWrap: { marginTop: S.x2 },
    progTrack: { height: 4, borderRadius: 2, backgroundColor: C.card2, overflow: 'hidden' },
    progFill: { height: 4, backgroundColor: K.brand },
    progText: { marginTop: S.x1, color: K.brand, ...T.meta },

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
