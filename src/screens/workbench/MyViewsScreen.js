import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';
import ReviewBlock from './ReviewBlock';

// 我的观点页（骨架版 · 2026-11-12）
// 总经理已批：第一版**只做 看 + 展开 + 删 + 重新评**，不放开长文写作（手机写长文痛苦，跟选题池「只做 AI 写」同一逻辑）；
// **不做搜索**（后端 views_list 支持 q，但电脑端界面没有搜索框，手机端也不许多一个，避免「手机能用电脑不能」）。
//
// 数据源：GET /views/list?limit&q（content 已截 400 字）、GET /views/get?id（全文）、
//         POST /views/review{id}、POST /views/del{ids}、GET /match（稿库语义匹配，本版不接）
// my_views 行：id / kind('topic'|'free'|'clash') / title / content / review / created_at / tags
//
// props
//   views   [{ id, kind, title, content, review, created_at }]
//   detail  { id, loading, error, view } | null   展开中/已展开的那条
//   onOpen(id) / onClose() / onDelete(view) / onReview(id)
//   onBack / activeTab / onTabPress

const SHAPE_H = 196;

const DEFAULT_VIEWS = [
  { id: 'v1', kind: 'clash', title: '认同「一个人赚不到钱，不是能力问题」', content: '【我的态度】同意\n【对方观点】一个人赚不到钱…\n【我的理由/延伸】我自己就是例子：能力够但一直不肯报价。', ai_review: { score: 82, verdict: '半立住', pros: ['「不肯报价」你自己有实例，站得住'], gaps: ['缺一个反例：能力差但卖得好的人'], questions: ['如果对方就是没能力呢？'], one_line: '有实例，缺反面' }, created_at: '2026-11-12 21:50' },
  { id: 'v2', kind: '自写', title: '把「能力表达」当产品做', content: '能力本身不值钱，值钱的是别人能不能在一句话里听懂你值多少钱。所以表达不是包装，是定价。', ai_review: { score: 88, verdict: '能立住', pros: ['「表达就是定价」是判断不是结论'], gaps: [], questions: ['谁的价格被你说低了？'], one_line: '可以直接当论点' }, created_at: '2026-11-11 09:12' },
  { id: 'v3', kind: '原话', title: '有感而发：拖延', content: '拖延不是懒，是怕做完之后发现自己不行。所以拖延的人往往对自己期待过高。', ai_review: null, created_at: '2026-11-10 23:40' },
];

// my_views.kind 的真实取值只有四个（2026-11-12 后端确认）：
//   自写 / 原话 / clash / free
// 「对撞」不是 kind —— 它是 clash 那条的 tags[0]（写入：",".join(['对撞', verdict, atom])）；
// 「topic」在 pool_db.py 里没有任何写入点，映射表里不许出现它。
// 「原话」代码里找不到写入点，库里只有 1 条（早期手工入库），认它、别报错、别动那条数据。
const KIND_LABEL = {
  '自写': '自写',
  '原话': '原话',
  clash: '表态',
  free: '有感',
};
const kindLabel = (k) => KIND_LABEL[String(k || '')] || '未分类';

export default function MyViewsScreen({
  views = DEFAULT_VIEWS,
  detail = null,
  activeTab = 'workbench',
  onBack,
  onTabPress,
  onOpen,
  onClose,
  onDelete,
  onReview,
}) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);

  const openId = detail && detail.id;

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
              我的观点
            </Text>
            <Text style={s.subTitle} numberOfLines={1} allowFontScaling={false}>
              {views.length} 条 · 一字未改的原话
            </Text>
          </View>
        </View>

        {views.length === 0 ? (
          <Text style={s.empty} allowFontScaling={false}>
            还没有观点。在观点库表态、或从选题池写一条，都会落到这里。
          </Text>
        ) : null}

        {views.map((v) => {
          const open = openId === v.id;
          const score = v.review && v.review.score;
          return (
            <View key={v.id} style={s.cardWrap}>
              <Pressable
                style={s.row}
                onPress={() => (open ? onClose && onClose() : onOpen && onOpen(v.id))}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${v.title}，${score == null ? '未评' : score + ' 分'}`}
              >
                <View style={s.rowTop}>
                  <View style={s.kindPill}>
                    <Text style={s.kindText} allowFontScaling={false}>
                      {kindLabel(v.kind)}
                    </Text>
                  </View>
                  <Text style={s.rowTitle} numberOfLines={2} allowFontScaling={false}>
                    {v.title || '（无标题）'}
                  </Text>
                  <Text
                    style={[s.rowScore, { color: score == null ? C.ink3 : score >= 85 ? C.good : C.ink }]}
                    allowFontScaling={false}
                  >
                    {score == null ? '未评' : score}
                  </Text>
                </View>
                
              </Pressable>

              {open ? (
                <View style={s.detail}>
                  {detail.loading ? (
                    <Text style={s.muted} allowFontScaling={false}>
                      读原文…
                    </Text>
                  ) : detail.error ? (
                    <Text style={[s.muted, { color: C.bad }]} allowFontScaling={false}>
                      {detail.error}
                    </Text>
                  ) : detail.view ? (
                    <>
                      <Text style={s.detailLabel} allowFontScaling={false}>
                        我的原文（一字未改）
                      </Text>
                      <View style={s.origin}>
                        <Text style={s.originText} allowFontScaling={false}>
                          {detail.view.content}
                        </Text>
                      </View>
                      <Text style={s.detailMeta} allowFontScaling={false}>
                        {detail.view.created_at || ''}
                      </Text>

                      <View style={s.reviewWrap}>
                        <ReviewBlock review={detail.view.review} onRetry={() => onReview && onReview(v.id)} />
                      </View>

                      <View style={s.acts}>
                        <Pressable style={s.actBtn} onPress={() => onReview && onReview(v.id)} accessibilityRole="button">
                          <Text style={s.actText} allowFontScaling={false}>
                            重新评
                          </Text>
                        </Pressable>
                        <Pressable style={s.actBtn} onPress={() => onDelete && onDelete(v)} accessibilityRole="button">
                          <Text style={[s.actText, { color: C.bad }]} allowFontScaling={false}>
                            删
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
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

    empty: { marginTop: S.x6, marginHorizontal: S.page, color: C.ink2, ...T.body },

    cardWrap: { marginTop: S.x4, marginHorizontal: S.page, backgroundColor: C.card, borderRadius: R.small, overflow: 'hidden' },
    row: { padding: S.x4 },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: S.x2 },
    kindPill: { height: 20, paddingHorizontal: S.x2, borderRadius: R.capsule, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
    kindText: { color: C.ink2, ...T.meta },
    rowTitle: { flex: 1, color: C.ink, ...T.title },
    rowScore: { ...T.meta, fontWeight: '700' },
    rowBody: { marginTop: S.x2, color: C.ink2, ...T.meta },

    detail: { paddingHorizontal: S.x4, paddingBottom: S.x4 },
    muted: { color: C.ink2, ...T.meta },
    detailLabel: { color: C.ink2, ...T.meta, fontWeight: '500', marginBottom: S.x1 },
    origin: { backgroundColor: C.card2, borderRadius: R.small, padding: S.x4 },
    originText: { color: C.ink, ...T.body },
    detailMeta: { marginTop: S.x2, color: C.ink3, ...T.meta },
    reviewWrap: { marginTop: S.x3 },
    acts: { marginTop: S.x3, flexDirection: 'row', gap: S.x2 },
    actBtn: { height: 32, paddingHorizontal: S.x3, borderRadius: R.capsule, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
    actText: { color: C.ink, ...T.meta, fontWeight: '500' },
  });
