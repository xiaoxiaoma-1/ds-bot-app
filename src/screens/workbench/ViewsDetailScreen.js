import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useRoles } from './roles';
import ReviewBlock from './ReviewBlock';

// 观点库 · 详情页（整页，不是弹层）
// 老板：「点一下那个卡片，它会变成一个完整的页面，下面有什么 AI 怎么写、AI 怎么看」
// 但电脑端观点库没有任何 AI 功能（clash 只有 list/answer/pending/today 四个路由），
// 所以本页的 AI 全部是**复用别的模块**，两项都经总经理批准（2026-11-12）：
//   ① 「AI 怎么看这条」→ 复用 POST /views/review（后端 VIEW_SYSTEM，不许改原文、不许给改写版本）
//   ② 「让 AI 讲透这条」→ 复用 POST /explain（流式）
// 不做：「AI 认同怎么写 / 不认同怎么写」（会替老板思考，与 review 铁律冲突）、「AI 拓展」（电脑端没有）
// 页面必须显示「这是 AI 的看法，不是事实」，不许只写在注释里。
//
// props
//   topic    { id, claim, author, type, confidence, original, url }
//   review   { loading } | { score, verdict, pros, gaps, questions, one_line } | { error }
//   explain  { loading } | { text } | { error }
//   onReview()  触发一次评审
//   onExplain() 触发一次讲透
//     实测（2026-11-12，node 直连 8788）：POST /api/dsh-media/explain 返回 **一次性整段纯文本**（5.0s / 252 字），
//     不是流式。所以这里只做「正在讲…」→ 整段一次渲染，绝不假装逐字上屏。
//     传输层见 explainCall.js（baseUrl / token 由调用方给，不写死）。
//   onAnswer(verdict, why) → Promise   存进「我的观点」
//   onBack()

const SHAPE_H = 196;
const DISCLAIMER = '这是 AI 的看法，不是事实';
const OPTIONS = [
  { key: 'agree', label: '认同', colorKey: 'brand' },
  { key: 'disagree', label: '不认同', colorKey: 'bad' },
  { key: 'unsure', label: '不确定', colorKey: 'ink2' },
];

export default function ViewsDetailScreen({
  topic,
  review = null,
  explain = null,
  onBack,
  onReview,
  onExplain,
  onAnswer,
}) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);

  const [verdict, setVerdict] = useState(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);

  const submit = async () => {
    if (!verdict) {
      setErr('先选一个态度：认同 / 不认同 / 不确定');
      return;
    }
    const t = why.trim();
    if (!t) {
      setErr('写一句为什么——空着存不进去');
      return;
    }
    if (!onAnswer || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onAnswer(verdict, t);
      setWhy('');
      setVerdict(null);
    } catch (e) {
      setErr(String((e && e.message) || '没存上'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + S.x5 }} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <View style={s.shape} />
          <Pressable style={[s.back, { top: insets.top }]} onPress={onBack} accessibilityRole="button" accessibilityLabel="返回">
            <Text style={s.backText} allowFontScaling={false}>
              ‹
            </Text>
          </Pressable>
          <View style={[s.headText, { top: insets.top + S.x6 * 2 + S.x1 }]}>
            <Text style={s.title} allowFontScaling={false}>
              这条观点
            </Text>
            <Text style={s.subTitle} numberOfLines={1} allowFontScaling={false}>
              原文 · AI 怎么看 · 让 AI 讲透
            </Text>
          </View>
        </View>

        {/* ① 原文 */}
        <View style={s.quoteCard}>
          <Text style={s.claim} allowFontScaling={false}>
            {topic ? topic.claim : ''}
          </Text>
          <Text style={s.author} allowFontScaling={false}>
            @{topic && topic.author ? topic.author : '来源未标'}
          </Text>
          <Text style={s.meta} allowFontScaling={false}>
            {[topic && topic.type, topic && topic.confidence === 'high' ? '高可信' : '中可信'].filter(Boolean).join(' · ')}
          </Text>
          {topic && topic.url ? (
            <Text style={s.link} numberOfLines={1} allowFontScaling={false}>
              原始出处 {String(topic.url).slice(0, 40)}
            </Text>
          ) : null}
        </View>

        {/* ② AI 怎么看（评的是这段原文，不是你自己写的观点——语义已变，已报备） */}
        <View style={s.block}>
          {onReview ? null : (
            <Text style={s.notice} allowFontScaling={false}>
              评审还没接上（接上后这里自动显示）
            </Text>
          )}
          <ReviewBlock review={review} onRetry={onReview ? onReview : () => setNotice('评审还没接上')} />
        </View>

        {/* ③ 让 AI 讲透 */}
        <View style={s.block}>
          <View style={s.aiHead}>
            <Text style={s.aiTitle} allowFontScaling={false}>
              让 AI 讲透这条
            </Text>
            <Pressable
              onPress={() => {
                if (!onExplain) {
                  setNotice('讲透还没接上：onExplain 没传进来');
                  return;
                }
                onExplain();
              }}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={s.aiAction} allowFontScaling={false}>
                {explain && explain.loading ? '正在讲…' : explain && explain.text ? '重新讲' : '开讲'}
              </Text>
            </Pressable>
          </View>
          {explain && explain.error ? (
            <Text style={[s.aiBody, { color: C.bad }]} allowFontScaling={false}>
              讲不了：{explain.error}
            </Text>
          ) : explain && explain.text ? (
            <Text style={s.aiBody} allowFontScaling={false}>
              {explain.text}
              {explain.loading ? '▍' : ''}
            </Text>
          ) : (
            <Text style={s.aiMuted} allowFontScaling={false}>
              {explain && explain.loading ? '正在讲…（一次性给完整一段，约 5 秒）' : '它说的是什么、为什么这么说、能用在哪'}
            </Text>
          )}
          <Text style={s.disclaimer} allowFontScaling={false}>
            {DISCLAIMER}
          </Text>
        </View>

        {/* ④ 表态 */}
        <View style={s.block}>
          <Text style={s.aiTitle} allowFontScaling={false}>
            你的态度
          </Text>
          <View style={s.optRow}>
            {OPTIONS.map((o) => {
              const on = verdict === o.key;
              const tone = o.colorKey === 'brand' ? K.brand : o.colorKey === 'bad' ? C.bad : C.ink2;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => {
                    setVerdict(o.key);
                    if (err) setErr(null);
                  }}
                  style={[s.opt, on ? { backgroundColor: K.brand } : null]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[s.optText, { color: on ? K.onBrand : tone }]} allowFontScaling={false}>
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            style={s.input}
            value={why}
            onChangeText={(v) => {
              setWhy(v);
              if (err) setErr(null);
            }}
            placeholder={verdict === 'disagree' ? '为什么反对？写一句' : verdict === 'unsure' ? '为什么说不清？写一句' : '为什么认同？写一句'}
            placeholderTextColor={C.ink3}
            multiline
            textAlignVertical="top"
            allowFontScaling={false}
          />
          {err ? <Text style={s.err} allowFontScaling={false}>{err}</Text> : null}
          {notice ? <Text style={s.notice} allowFontScaling={false}>{notice}</Text> : null}
          <View style={s.footRow}>
            <Text style={s.footNote} numberOfLines={1} allowFontScaling={false}>
              存了就进「我的观点」，撤不回
            </Text>
            <Pressable style={[s.saveBtn, busy ? { opacity: 0.6 } : null]} onPress={submit} disabled={busy} accessibilityRole="button">
              <Text style={s.saveText} allowFontScaling={false}>
                {busy ? '存…' : '存进我的观点'}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
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

    quoteCard: { marginTop: S.x4, marginHorizontal: S.page, backgroundColor: C.card, borderRadius: R.big, padding: S.x5 },
    claim: { color: C.ink, ...T.title, lineHeight: 26 },
    author: { marginTop: S.x3, color: C.ink2, ...T.meta },
    meta: { marginTop: S.x1, color: C.ink3, ...T.meta },
    link: { marginTop: S.x2, color: K.brand, ...T.meta },

    block: { marginTop: S.x4, marginHorizontal: S.page },
    aiHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    aiTitle: { color: C.ink, ...T.title },
    aiAction: { color: K.brand, ...T.meta, fontWeight: '500' },
    aiBody: { marginTop: S.x2, color: C.ink, ...T.body },
    aiMuted: { marginTop: S.x2, color: C.ink3, ...T.meta },
    disclaimer: { marginTop: S.x3, color: C.ink3, ...T.meta },

    optRow: { marginTop: S.x3, flexDirection: 'row', gap: S.x2 },
    opt: { height: 32, paddingHorizontal: S.x4, borderRadius: R.capsule, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
    optText: { ...T.meta, fontWeight: '500' },

    input: { marginTop: S.x3, minHeight: 96, backgroundColor: C.card, borderRadius: R.small, padding: S.x4, color: C.ink, ...T.body },
    err: { marginTop: S.x2, color: C.bad, ...T.meta },
    notice: { marginTop: S.x2, color: C.ink3, ...T.meta },
    footRow: { marginTop: S.x3, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.x2 },
    footNote: { flex: 1, color: C.ink3, ...T.meta },
    saveBtn: { height: 44, paddingHorizontal: S.x5, borderRadius: R.capsule, backgroundColor: K.brand, alignItems: 'center', justifyContent: 'center' },
    saveText: { color: K.onBrand, ...T.title },
  });
