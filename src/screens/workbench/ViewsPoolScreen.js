import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';

// 观点库页 · 探探式（骨架版 · 2026-11-12）
// 左滑认同 / 右滑不认同。
//
// 电脑端口径（pool_db.py 的 clash_list / clash_answer，不是我自己定的）：
//   clash_list  → 一条平铺流 { id, author, claim(16–180字), type, confidence, original, url } + left + done
//                 排序 random()，不分类不分组；表过态的原子被 SQL 排除，永不再出现
//   clash_answer { atomId, verdict:'agree'|'disagree', why } → why 为空后端直接拒
//                 「必须写点什么才能存——没有输出，这条知识就不是你的」
//   → 这一屏注定比探探重：滑一下不够，每条都要写理由。不许默认理由、不许空提交、不许绕过后端。
//
// 总经理已批（2026-11-12）：
//   ① 预取 10 张，剩 5 张就补（不是剩 3，网络慢时剩 3 正卡在最顺手那一刻）
//   ② 理由用半屏 sheet，不做卡片翻面（翻面看不到原文，写出来的理由会飘）
//   ③ **sheet 上沿不许盖住「在评什么」**：sheet 里带一条原文引用块，卡片区收起，
//      键盘弹起时 sheet 是 flex 块（不是浮层），只会被压扁不会被顶出屏幕
//   ④ 左滑认同 / 右滑不认同，与探探本义相反，卡片上固定标注「← 认同」「不认同 →」
//   ⑤ 提交前可弹回；提交后不可撤回，sheet 里写明
//   ⑥ 只用 RN 内置 Animated + PanResponder，归位 S3 弹簧 420/20
//   ⑦ 滑动不能是唯一入口（手抖 / 屏幕有水 / 戴手套 / 读屏都滑不动）：卡片右上角给「用按钮代替滑动」，
//      展开三枚胶囊 认同 / 不认同 / 不确定 —— 后端 verdict 是 agree|disagree|unsure 三值，
//      只给两枚等于逼用户瞎选，存进「我的观点」的就是假数据。
//
// props
//   topics [{ id, claim, author, type, confidence, original, url }]
//   done / left           已表态 / 还剩（后端给）
//   onAnswer(topic, verdict, why) → Promise
//   onNeedMore() → Promise  剩 5 张时调一次
//   onUndo() → Promise       撤回「最后一次已提交」的表态（GET /api/undo 现成，mobile_server.py 里有）
//                            文案写「撤回上一条」，不写「撤销」—— 撤的是已存的，不是划到一半弹回去
//   onOpenDetail(topic)     点卡片（不滑动）展开成详情整页
//   onBack / activeTab / onTabPress

const SHAPE_H = 196;
const CARD_H = 360; // 容得下 180 字上限（9 行 ×21 + 元信息/作者/方向标注），再高就留白
const SWIPE_OUT = 420;
const THRESHOLD = 96;

const springIn = { tension: 420, friction: 20, useNativeDriver: false }; // 令牌 S3；pan.x 是 JS 驱动，弹簧必须同为 JS

const DEFAULT_TOPICS = [
  { id: 'v1', claim: '一个人赚不到钱，不是能力问题，是他不肯把自己放到能被定价的位置上。', author: '李笑来', type: '观点', confidence: 'high' },
  { id: 'v2', claim: '写作的第一性原理不是表达欲，是「让别人看懂」。看不懂的表达，再真诚也没有价值。', author: '万维钢', type: '观点', confidence: 'high' },
  { id: 'v3', claim: '长期主义不是熬时间，是持续做复利动作；摊位摆十年不会自己长出东西。', author: '刘润', type: '观点', confidence: 'medium' },
  { id: 'v4', claim: '你不需要更多的时间，你需要更少的选项。选择本身比执行更耗人。', author: '张潇雨', type: '观点', confidence: 'medium' },
  { id: 'v5', claim: '所有「准备好了再做」都是拖延的另一种说法，做起来才知道缺什么。', author: '李诞', type: '观点', confidence: 'high' },
];

export default function ViewsPoolScreen({
  topics = DEFAULT_TOPICS,
  done = 12,
  left = 468,
  activeTab = 'workbench',
  onBack,
  onTabPress,
  onAnswer,
  onNeedMore,
  onUndo,
  onOpenDetail,
}) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);

  const [idx, setIdx] = useState(0);
  const [doneN, setDoneN] = useState(done);
  const [verdict, setVerdict] = useState(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [manual, setManual] = useState(false); // 无障碍兜底面板
  const [undoBusy, setUndoBusy] = useState(false);

  const pan = useRef(new Animated.ValueXY()).current;
  const asked = useRef(false);

  const cur = topics[idx] || null;
  const next = topics[idx + 1] || null;
  const remain = Math.max(0, left - (doneN - done));

  useEffect(() => {
    const remainLocal = topics.length - idx;
    if (remainLocal <= 5 && remainLocal > 0 && !asked.current && onNeedMore) {
      asked.current = true;
      Promise.resolve(onNeedMore()).catch(() => {});
    }
    if (remainLocal > 8) asked.current = false;
  }, [idx, topics.length, onNeedMore]);

  const settle = useCallback(
    (v) => {
      setErr(null);
      setVerdict(v);
      setWhy('');
      Animated.spring(pan, { toValue: { x: v === 'agree' ? -140 : 140, y: 0 }, ...springIn }).start();
    },
    [pan],
  );

  const springBack = useCallback(() => {
    setVerdict(null);
    Animated.spring(pan, { toValue: { x: 0, y: 0 }, ...springIn }).start();
  }, [pan]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !verdict,
        onMoveShouldSetPanResponder: (e, g) => !verdict && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
        onPanResponderRelease: (e, g) => {
          // 轻点不滑：展开详情整页（老板要的「点一下变成完整页面」）
          if (Math.abs(g.dx) <= 6 && Math.abs(g.dy) <= 6) {
            if (onOpenDetail && cur) onOpenDetail(cur);
            return;
          }
          if (g.vx <= -0.4 || g.dx <= -THRESHOLD) settle('agree');
          else if (g.vx >= 0.4 || g.dx >= THRESHOLD) settle('disagree');
          else springBack();
        },
        onPanResponderTerminate: () => springBack(),
      }),
    [pan, settle, springBack, verdict, onOpenDetail, cur],
  );

  const undo = async () => {
    if (!onUndo || undoBusy) return;
    setUndoBusy(true);
    try {
      await onUndo();
      setDoneN((n) => Math.max(done, n - 1));
      setIdx((i) => Math.max(0, i - 1));
    } catch (e) {
      setErr(String((e && e.message) || '撤不回'));
    } finally {
      setUndoBusy(false);
    }
  };

  const submit = async () => {
    const t = why.trim();
    if (!t) {
      setErr('写一句再存——空着存不进去');
      return;
    }
    if (!cur || busy) return;
    if (!onAnswer) {
      setErr('接口还没接：onAnswer 没传进来');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onAnswer(cur, verdict, t);
      setDoneN((n) => n + 1);
      Animated.timing(pan, {
        toValue: { x: verdict === 'agree' ? -SWIPE_OUT : SWIPE_OUT, y: 0 },
        duration: 180,
        useNativeDriver: false,
      }).start(() => {
        pan.setValue({ x: 0, y: 0 });
        setVerdict(null);
        setWhy('');
        setIdx((i) => i + 1);
      });
    } catch (e) {
      setErr(String((e && e.message) || '没存上'));
    } finally {
      setBusy(false);
    }
  };

  const leftOp = pan.x.interpolate({ inputRange: [-THRESHOLD, -24, 0], outputRange: [1, 0.4, 0.22], extrapolate: 'clamp' });
  const rightOp = pan.x.interpolate({ inputRange: [0, 24, THRESHOLD], outputRange: [0.22, 0.4, 1], extrapolate: 'clamp' });
  const nextScale = pan.x.interpolate({ inputRange: [-THRESHOLD, 0, THRESHOLD], outputRange: [1, 0.96, 1], extrapolate: 'clamp' });
  const nextShift = pan.x.interpolate({ inputRange: [-THRESHOLD, 0, THRESHOLD], outputRange: [0, 8, 0], extrapolate: 'clamp' });

  const empty = !cur && !verdict;

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={s.top}>
        <View style={s.shape} />
        <Pressable style={[s.back, { top: insets.top }]} onPress={onBack} accessibilityRole="button" accessibilityLabel="返回">
          <Text style={s.backText} allowFontScaling={false}>
            ‹
          </Text>
        </Pressable>
        <View style={[s.headText, { top: insets.top + S.x6 * 2 + S.x1 }]}>
          <Text style={s.title} allowFontScaling={false}>
            观点库
          </Text>
          <Text style={s.subTitle} numberOfLines={1} allowFontScaling={false}>
            已表态 {doneN} · 还剩 {remain}
          </Text>
        </View>
      </View>

      {/* 卡片区：写理由时整块收起，把高度让给 sheet */}
      {verdict ? null : (
        <View style={s.stage}>
          {empty ? (
            <View style={s.emptyBox}>
              <Text style={s.emptyTitle} allowFontScaling={false}>
                全看完了
              </Text>
              <Text style={s.emptySub} allowFontScaling={false}>
                你已经表态 {doneN} 条，写下的理由都在「我的观点」里
              </Text>
            </View>
          ) : (
            <View style={s.stack}>
              {next ? (
                <Animated.View style={[s.card, s.cardBack, { transform: [{ scale: nextScale }, { translateY: nextShift }] }]}>
                  <Text style={s.cardClaim} numberOfLines={6} allowFontScaling={false}>
                    {next.claim}
                  </Text>
                </Animated.View>
              ) : null}

              <Animated.View
                {...responder.panHandlers}
                style={[
                  s.card,
                  s.cardFront,
                  {
                    transform: [
                      { translateX: pan.x },
                      { translateY: pan.y },
                      { rotate: pan.x.interpolate({ inputRange: [-220, 0, 220], outputRange: ['-7deg', '0deg', '7deg'], extrapolate: 'clamp' }) },
                    ],
                  },
                ]}
              >
                <View style={s.cardHead}>
                  <Text style={s.cardMetaText} allowFontScaling={false}>
                    {cur.type || '观点'} · {cur.confidence === 'high' ? '高可信' : '中可信'}
                  </Text>
                  <Pressable onPress={() => setManual((v) => !v)} hitSlop={8} accessibilityRole="button" accessibilityLabel="用按钮代替滑动">
                    <Text style={s.manualLink} allowFontScaling={false}>
                      {manual ? '收起按钮' : '用按钮代替滑动'}
                    </Text>
                  </Pressable>
                </View>
                <Text style={s.cardClaim} numberOfLines={9} allowFontScaling={false}>
                  {cur.claim}
                </Text>
                <Text style={s.cardAuthor} numberOfLines={1} allowFontScaling={false}>
                  @{cur.author || '来源未标'}
                </Text>

                <View style={s.dirRow}>
                  <Animated.Text style={[s.dirText, { opacity: leftOp, color: K.brand }]} allowFontScaling={false}>
                    ← 认同
                  </Animated.Text>
                  <Animated.Text style={[s.dirText, { opacity: rightOp, color: C.bad }]} allowFontScaling={false}>
                    不认同 →
                  </Animated.Text>
                </View>
              </Animated.View>
            </View>
          )}
          {empty || !manual ? null : (
            <View style={s.manualRow}>
              <Pressable style={s.manualPill} onPress={() => settle('agree')} accessibilityRole="button">
                <Text style={[s.manualText, { color: K.brand }]} allowFontScaling={false}>认同</Text>
              </Pressable>
              <Pressable style={s.manualPill} onPress={() => settle('disagree')} accessibilityRole="button">
                <Text style={[s.manualText, { color: C.bad }]} allowFontScaling={false}>不认同</Text>
              </Pressable>
              <Pressable style={s.manualPill} onPress={() => settle('unsure')} accessibilityRole="button">
                <Text style={[s.manualText, { color: C.ink2 }]} allowFontScaling={false}>不确定</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {/* 理由 sheet：flex 块，键盘只把它压扁，不会顶出屏幕；顶部引用原文，写的时候看得见在评什么 */}
      {verdict ? (
        <View style={s.sheet}>
          <Text style={s.sheetTitle} allowFontScaling={false}>
            {verdict === 'agree' ? '你为什么认同？' : verdict === 'disagree' ? '你为什么不认同？' : '你为什么说不清？'}
          </Text>
          <View style={s.quote}>
            <Text style={s.quoteText} numberOfLines={2} allowFontScaling={false}>
              {cur ? cur.claim : ''}
            </Text>
          </View>
          <TextInput
            style={s.input}
            value={why}
            onChangeText={(v) => {
              setWhy(v);
              if (err) setErr(null);
            }}
            placeholder="写一句为什么，它跟你有什么关系"
            placeholderTextColor={C.ink3}
            multiline
            autoFocus
            textAlignVertical="top"
            allowFontScaling={false}
          />
          {err ? <Text style={s.errText} allowFontScaling={false}>{err}</Text> : null}
          <View style={s.sheetActions}>
            <Pressable style={s.ghostBtn} onPress={springBack} disabled={busy} accessibilityRole="button">
              <Text style={s.ghostText} allowFontScaling={false}>
                弹回去
              </Text>
            </Pressable>
            <Pressable style={[s.saveBtn, busy ? { opacity: 0.6 } : null]} onPress={submit} disabled={busy} accessibilityRole="button">
              <Text style={s.saveText} allowFontScaling={false}>
                {busy ? '存…' : '存进我的观点'}
              </Text>
            </Pressable>
          </View>
          <Text style={s.sheetNote} numberOfLines={1} allowFontScaling={false}>
            存了就进「我的观点」，撤不回
          </Text>
        </View>
      ) : (
        <View style={s.hintRow}>
          <Text style={s.hint} allowFontScaling={false}>
            左右滑动表态，每条都要写一句理由才能存
          </Text>
          {doneN > done ? (
            <Pressable onPress={undo} disabled={undoBusy} hitSlop={8} accessibilityRole="button">
              <Text style={s.undoText} allowFontScaling={false}>
                {undoBusy ? '撤回中…' : '撤回上一条'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {verdict ? (
        <View style={{ height: insets.bottom + S.x2 }} />
      ) : (
        <>
          <View style={{ height: onTabPress ? dockPadding(insets, S) : S.x3 + insets.bottom }} />
          {onTabPress ? <Dock activeTab={activeTab} onTabPress={onTabPress} /> : null}
        </>
      )}
    </KeyboardAvoidingView>
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

    stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    stack: { width: 353, height: CARD_H },
    card: {
      position: 'absolute',
      left: 0,
      top: 0,
      width: 353,
      height: CARD_H,
      borderRadius: R.big,
      backgroundColor: C.card,
      padding: S.x5,
    },
    cardBack: { backgroundColor: C.card2 },
    cardFront: {},
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: S.x3 },
    cardMetaText: { color: C.ink2, ...T.meta },
    manualLink: { color: C.ink3, ...T.meta },
    manualRow: { flexDirection: 'row', gap: S.x2, marginTop: S.x3 },
    manualPill: { height: 32, paddingHorizontal: S.x4, borderRadius: R.capsule, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
    manualText: { ...T.meta, fontWeight: '500' },
    cardClaim: { color: C.ink, ...T.body },
    cardAuthor: { marginTop: S.x4, color: C.ink2, ...T.meta },
    dirRow: { position: 'absolute', left: S.x5, right: S.x5, bottom: S.x5, flexDirection: 'row', justifyContent: 'space-between' },
    dirText: { ...T.meta, fontWeight: '500' },

    emptyBox: { alignItems: 'center', gap: S.x2, paddingHorizontal: S.x5 },
    emptyTitle: { color: C.ink, ...T.section },
    emptySub: { color: C.ink2, ...T.meta, textAlign: 'center' },

    sheet: {
      flex: 1,
      borderTopLeftRadius: R.big,
      borderTopRightRadius: R.big,
      backgroundColor: C.card,
      paddingHorizontal: S.x5,
      paddingTop: S.x4,
    },
    sheetTitle: { color: C.ink, ...T.title },
    quote: { marginTop: S.x3, paddingLeft: S.x3, backgroundColor: C.card2, borderRadius: R.small, padding: S.x3 },
    quoteText: { color: C.ink2, ...T.meta, lineHeight: 20 },
    input: { marginTop: S.x3, flexShrink: 1, minHeight: 72, backgroundColor: C.card2, borderRadius: R.small, padding: S.x4, color: C.ink, ...T.body },
    errText: { marginTop: S.x2, color: C.bad, ...T.meta },
    sheetActions: { marginTop: S.x3, flexDirection: 'row', justifyContent: 'flex-end', gap: S.x2 },
    ghostBtn: { height: 44, paddingHorizontal: S.x4, borderRadius: R.capsule, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
    ghostText: { color: C.ink, ...T.title },
    saveBtn: { height: 44, paddingHorizontal: S.x5, borderRadius: R.capsule, backgroundColor: K.brand, alignItems: 'center', justifyContent: 'center' },
    saveText: { color: K.onBrand, ...T.title },
    sheetNote: { marginTop: S.x2, color: C.ink3, ...T.meta },

    hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.x3, marginHorizontal: S.page, marginBottom: S.x2 },
    hint: { color: C.ink3, ...T.meta, flexShrink: 1 },
    undoText: { color: K.brand, ...T.meta, fontWeight: '500' },
  });
