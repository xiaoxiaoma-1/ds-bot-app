import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { useRoles } from './roles';

// AI 评审块（共用件）：我的观点展开、观点库详情页都用这一块。
// 数据来自 POST /api/dsh-media/views/review，字段是后端 VIEW_SYSTEM 定死的：
//   { score, verdict: '能立住'|'半立住'|'立不住', pros[], gaps[], questions[], one_line }
// 后端铁律：不许改原文、不许给改写版本。所以这块**只能展示评价**，绝不出现「改写示范」。
//
// 免责句「这是 AI 的看法，不是事实」必须真的显示出来，不能只写在注释里（总经理 2026-11-12 要求）。

const DISCLAIMER = '这是 AI 的看法，不是事实';

export default function ReviewBlock({ review, onRetry, compact }) {
  const { C, T, S, R } = useTheme();
  const K = useRoles();
  const s = makeStyles(C, T, S, R, K);

  const head = (
    <View style={s.headRow}>
      <Text style={s.headTitle} allowFontScaling={false}>
        AI 怎么看这条
      </Text>
      {review && !review.loading && onRetry ? (
        <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button">
          <Text style={s.retry} allowFontScaling={false}>
            重新评
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (!review) {
    return (
      <View style={s.box}>
        {head}
        <View style={s.actRow}>
          <Pressable style={s.primaryBtn} onPress={onRetry} accessibilityRole="button">
            <Text style={s.primaryText} allowFontScaling={false}>
              让 AI 评一下
            </Text>
          </Pressable>
        </View>
        <Text style={s.note} allowFontScaling={false}>
          {DISCLAIMER}
        </Text>
      </View>
    );
  }

  if (review.loading) {
    return (
      <View style={s.box}>
        {head}
        <Text style={s.muted} allowFontScaling={false}>
          AI 在评…（不会改你的字，只挑问题）
        </Text>
        <Text style={s.note} allowFontScaling={false}>
          {DISCLAIMER}
        </Text>
      </View>
    );
  }

  if (review.error) {
    return (
      <View style={s.box}>
        {head}
        <Text style={[s.muted, { color: C.bad }]} allowFontScaling={false}>
          评审失败：{review.error}
        </Text>
        <Text style={s.note} allowFontScaling={false}>
          {DISCLAIMER}
        </Text>
      </View>
    );
  }

  const sec = (title, arr) =>
    arr && arr.length ? (
      <View style={s.sec}>
        <Text style={s.secTitle} allowFontScaling={false}>
          {title}
        </Text>
        {arr.map((x, i) => (
          <Text key={i} style={s.secItem} allowFontScaling={false}>
            · {x}
          </Text>
        ))}
      </View>
    ) : null;

  return (
    <View style={s.box}>
      {head}
      <View style={s.scoreRow}>
        <Text style={[s.score, { color: scoreColor(review.score, C) }]} allowFontScaling={false}>
          {review.score == null ? '—' : review.score}
        </Text>
        <View style={s.scoreRight}>
          <Text style={s.verdict} allowFontScaling={false}>
            {review.verdict || '评完了'}
          </Text>
          {review.one_line ? (
            <Text style={s.oneLine} allowFontScaling={false}>
              {review.one_line}
            </Text>
          ) : null}
        </View>
      </View>

      {compact ? null : (
        <>
          {sec('立得住的地方', review.pros)}
          {sec('缺什么', review.gaps)}
          {sec('能问深的问句', review.questions)}
        </>
      )}

      <Text style={s.note} allowFontScaling={false}>
        {DISCLAIMER}
      </Text>
    </View>
  );
}

function scoreColor(score, C) {
  if (score == null) return C.ink2;
  if (score >= 85) return C.good;
  if (score >= 70) return C.ink;
  return C.ink2;
}

const makeStyles = (C, T, S, R, K) =>
  StyleSheet.create({
    box: { backgroundColor: C.card, borderRadius: R.small, padding: S.x4 },
    headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headTitle: { color: C.ink, ...T.title },
    retry: { color: K.brand, ...T.meta, fontWeight: '500' },
    actRow: { marginTop: S.x3, flexDirection: 'row' },
    primaryBtn: {
      height: 44,
      paddingHorizontal: S.x5,
      borderRadius: R.capsule,
      backgroundColor: K.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { color: K.onBrand, ...T.title },
    muted: { marginTop: S.x2, color: C.ink2, ...T.body },
    scoreRow: { marginTop: S.x3, flexDirection: 'row', alignItems: 'flex-start', gap: S.x3 },
    score: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
    scoreRight: { flex: 1 },
    verdict: { color: C.ink, ...T.body },
    oneLine: { marginTop: S.x1, color: C.ink2, ...T.meta },
    sec: { marginTop: S.x3 },
    secTitle: { color: C.ink2, ...T.meta, fontWeight: '500', marginBottom: S.x1 },
    secItem: { color: C.ink, ...T.body },
    note: { marginTop: S.x3, color: C.ink3, ...T.meta },
  });
