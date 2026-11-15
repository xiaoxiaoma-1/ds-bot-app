import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { expressionApi } from '../botApi';
import { readEventStream } from '../sse';
import { getBase, getSess } from '../store';
import { DocText, MARK_CAP, MdText, STATS } from './expressionShared';

// 表达训练 · 点评表（第二层）
//
// 2026-11-15 老板：「表达训练页讲完 → 跳到原文/润色/点评表 → 从左边缘右滑，直接退到了工作台页」。
// 病根：这两屏原来是同一个组件里的两个 stage，导航栈里只有一层，边缘手势只会 pop 整页。
// 治法：点评表独立成一个栈层（route: ExpressionReview），
//   左滑返回 = 系统手势 pop → 落回训练页（上一层），
//   左上角返回 = navigation.goBack() → 同一个落点；
//   两条路都不碰 navigate('Workbench') / navigate('MainTabs') 这类「跳回主页」的写法。
//
// 数据从训练页带过来（text / analyze 结果 / 词级片段），
// 因为 analyze 已经在训练页做完，这一屏只负责「看」：原文、润色（点了才发）、点评（SSE 边生成边显示）。

export default function ExpressionReviewScreen({ text = '', a = null, segs = [], cut = false, analyzeMs = null, onBack, onEdit }) {
  const { C, T, S, R } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState('orig'); // orig | polish | report
  const [polish, setPolish] = useState({ loading: false, text: '', err: null });
  // 点评：流式。chunks 按 200 字一块切，chars 是已收字数，interrupted 表示没等到 done
  const [report, setReport] = useState({ streaming: false, chunks: [], chars: 0, err: null, interrupted: false });

  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const stickRef = useRef(true); // 用户手动往上滚之后置 false，停止自动滚到底

  // 流式增量先攒着，每 80ms 刷一次、按 200 字一块切。
  // 目的：不让每个 delta 都触发一次整篇 Text 重排（1597 字时 delta 可能有几十上百条）。
  const pendingRef = useRef('');
  const chunksRef = useRef([]);
  const charsRef = useRef(0);
  const flushTimer = useRef(null);

  const flush = useCallback((force) => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    if (!pendingRef.current && !force) return;
    const add = pendingRef.current;
    pendingRef.current = '';
    if (add) {
      const last = chunksRef.current.length - 1;
      if (last >= 0 && chunksRef.current[last].length < 200) {
        chunksRef.current[last] += add;
      } else {
        chunksRef.current.push(add);
      }
      charsRef.current += add.length;
    }
    setReport((p) => (p.streaming ? { ...p, chunks: chunksRef.current.slice(), chars: charsRef.current } : p));
    if (stickRef.current && scrollRef.current) scrollRef.current.scrollToEnd({ animated: false });
  }, []);

  const pushDelta = useCallback(
    (t) => {
      pendingRef.current += t;
      if (!flushTimer.current) flushTimer.current = setTimeout(() => flush(false), 80);
    },
    [flush],
  );

  const runPolish = useCallback(() => {
    setTab('polish');
    if (polish.text || polish.loading) return;
    setPolish({ loading: true, text: '', err: null });
    expressionApi
      .polish(String(text).trim())
      .then((d) => setPolish({ loading: false, text: d.polished || '', err: null }))
      .catch((e) => setPolish({ loading: false, text: '', err: e.message }));
  }, [polish.text, polish.loading, text]);

  const runReport = useCallback(async () => {
    setTab('report');
    if (report.streaming || report.chars) return;

    const base = await getBase();
    const sess = await getSess();
    if (!base || !sess) {
      setReport({ streaming: false, text: '', chars: 0, err: '还没有会话凭证，回设置登录', interrupted: false, chunks: [] });
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const stats = a
      ? { fillers: a.fillers, hedges: a.hedges, vague: a.vague, totalWords: a.tokens, duration: 0 }
      : undefined;

    stickRef.current = true;
    pendingRef.current = '';
    chunksRef.current = [];
    charsRef.current = 0;
    setReport({ streaming: true, chunks: [], chars: 0, err: null, interrupted: false });

    await readEventStream({
      url: String(base).replace(/\/+$/, '') + '/api/expression/report/stream',
      token: sess,
      body: { fullText: String(text).trim(), stats },
      signal: ctrl.signal,
      onDelta: pushDelta,
      onDone: (d) => {
        flush(true);
        // 字数以服务端 done.chars 为准：报告里有 5 个非 BMP 字符，UTF-16 的 length 会多算 5 个
        const served = d && typeof d.chars === 'number' ? d.chars : null;
        setReport((p) => ({ ...p, streaming: false, chars: served === null ? p.chars : served }));
      },
      onError: (m) => {
        flush(true);
        setReport((p) =>
          charsRef.current > 0 ? { ...p, streaming: false, interrupted: true } : { ...p, streaming: false, err: m },
        );
      },
    });
  }, [report.streaming, report.chars, a, text, pushDelta, flush]);

  const cancelReport = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    flush(true);
    // 已收到的内容保留，标成中断
    setReport((p) => ({ ...p, streaming: false, interrupted: Boolean(p.chars) }));
  }, [flush]);

  const onScroll = useCallback((e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    stickRef.current = distance < 48; // 离底部 48 以内才算「贴着底」
  }, []);

  const statValue = (k) => {
    if (!a) return '--';
    const v = a[k];
    return v === null || v === undefined ? '--' : String(v);
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* 头固定在滚动区之外：返回永不会被内容滚走 */}
      <View style={s.head}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="返回">
          <Text style={s.back} allowFontScaling={false}>
            返回
          </Text>
        </Pressable>
        <Text style={s.title} allowFontScaling={false}>
          表达训练
        </Text>
        <View style={s.headSlot} />
      </View>

      <ScrollView
        ref={scrollRef}
        style={s.scrollFlex}
        contentContainerStyle={s.markedWrap}
        onScroll={onScroll}
        scrollEventThrottle={64}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.statsRow}>
          {STATS.map((it) => (
            <View key={it.k} style={s.statCell}>
              <Text style={[s.statNum, { color: it.color }]} allowFontScaling={false}>
                {statValue(it.k)}
              </Text>
              <Text style={s.statLabel} allowFontScaling={false}>
                {it.label}
              </Text>
            </View>
          ))}
        </View>

        <View style={s.docHead}>
          <Text style={s.docHeadText} allowFontScaling={false}>
            词级标注 · 用时 {analyzeMs === null || analyzeMs === undefined ? '--' : analyzeMs + ' ms'}
          </Text>
          {onEdit ? (
            <Pressable onPress={onEdit} hitSlop={10} accessibilityRole="button">
              <Text style={s.docEdit} allowFontScaling={false}>
                改一下
              </Text>
            </Pressable>
          ) : null}
        </View>
        {cut ? (
          <Text style={s.cutNote} allowFontScaling={false}>
            超过 {MARK_CAP} 字，之后的内容按纯文本显示（不再标色）
          </Text>
        ) : null}
        {segs && segs.length ? (
          <DocText segs={segs} style={s.doc} />
        ) : (
          <View style={s.center}>
            <ActivityIndicator color={C.accent} />
            <Text style={s.centerText} allowFontScaling={false}>
              正在标注
            </Text>
          </View>
        )}

        {tab === 'polish' ? (
          <View style={s.panel}>
            <Text style={s.panelTitle} allowFontScaling={false}>
              润色
            </Text>
            {polish.loading ? (
              <View style={s.center}>
                <ActivityIndicator color={C.accent} />
                <Text style={s.centerText} allowFontScaling={false}>
                  正在润色
                </Text>
              </View>
            ) : polish.err ? (
              <Text style={s.errText} allowFontScaling={false}>
                {polish.err}
              </Text>
            ) : (
              <>
                <Text style={s.panelLabel} allowFontScaling={false}>
                  原文
                </Text>
                <Text style={s.panelOrig} allowFontScaling={false}>
                  {String(text).trim()}
                </Text>
                <Text style={s.panelLabel} allowFontScaling={false}>
                  润色后
                </Text>
                <Text style={s.panelText} allowFontScaling={false}>
                  {polish.text}
                </Text>
              </>
            )}
          </View>
        ) : null}

        {tab === 'report' ? (
          <View style={s.panel}>
            <View style={s.panelHead}>
              <Text style={s.panelTitle} allowFontScaling={false}>
                点评
              </Text>
              {report.chars > 0 || report.streaming ? (
                <Text style={s.panelMeta} allowFontScaling={false}>
                  已生成 {report.chars} 字
                </Text>
              ) : null}
            </View>
            {report.err ? (
              <Text style={s.errText} allowFontScaling={false}>
                {report.err}
              </Text>
            ) : null}
            <MdText text={report.chunks.join('')} style={s.panelText} />
            {report.streaming && report.chars === 0 ? (
              <View style={s.center}>
                <ActivityIndicator color={C.accent} />
                <Text style={s.centerText} allowFontScaling={false}>
                  正在分析… 0 字
                </Text>
              </View>
            ) : null}
            {report.interrupted ? (
              <Text style={s.interrupted} allowFontScaling={false}>
                生成中断
              </Text>
            ) : null}
            {report.streaming ? (
              <Pressable onPress={cancelReport} style={s.cancelBtn} hitSlop={8} accessibilityRole="button">
                <Text style={s.cancelText} allowFontScaling={false}>
                  取消
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={[s.tabs, { paddingBottom: Math.max(insets.bottom, S.x3) }]}>
        <Pressable style={[s.tabBtn, tab === 'orig' ? s.tabOn : null]} onPress={() => setTab('orig')}>
          <Text style={[s.tabText, tab === 'orig' ? s.tabTextOn : null]} allowFontScaling={false}>
            原文
          </Text>
        </Pressable>
        <Pressable style={[s.tabBtn, tab === 'polish' ? s.tabOn : null]} onPress={runPolish}>
          <Text style={[s.tabText, tab === 'polish' ? s.tabTextOn : null]} allowFontScaling={false}>
            润色
          </Text>
        </Pressable>
        <Pressable style={[s.tabBtn, tab === 'report' ? s.tabOn : null]} onPress={runReport}>
          <Text style={[s.tabText, tab === 'report' ? s.tabTextOn : null]} allowFontScaling={false}>
            点评
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (C, T, S, R) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    head: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: S.page, gap: S.x3 },
    back: { color: C.ink2, ...T.body },
    title: { color: C.ink, ...T.title, flex: 1, textAlign: 'center' },
    headSlot: { width: 32 },
    // RN flexShrink 默认 0：不给 flex:1 时 ScrollView 按内容撑高，底部 tabs 会被挤出可视区
    scrollFlex: { flex: 1 },
    markedWrap: { paddingHorizontal: S.page, paddingTop: S.x3, paddingBottom: S.x6 },
    statsRow: { flexDirection: 'row', gap: S.x2, marginBottom: S.x4 },
    statCell: { flex: 1, backgroundColor: C.card, borderRadius: R.small, paddingVertical: S.x3, alignItems: 'center', gap: S.x1 },
    statNum: { ...T.section },
    statLabel: { color: C.ink3, ...T.meta },
    docHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: S.x2 },
    docHeadText: { color: C.ink3, ...T.meta },
    docEdit: { color: C.accent, ...T.meta },
    cutNote: { color: C.ink3, ...T.meta, marginBottom: S.x2 },
    doc: { color: C.ink, ...T.body, lineHeight: 26 },
    panel: { marginTop: S.x6, backgroundColor: C.card, borderRadius: R.small, padding: S.x4, gap: S.x2 },
    panelHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    panelTitle: { color: C.ink, ...T.title },
    panelMeta: { color: C.ink3, ...T.meta },
    panelLabel: { color: C.ink3, ...T.meta },
    panelOrig: { color: C.ink2, ...T.body },
    panelText: { color: C.ink, ...T.body },
    center: { alignItems: 'center', justifyContent: 'center', paddingVertical: S.x6, gap: S.x2, flexDirection: 'row' },
    centerText: { color: C.ink3, ...T.meta },
    interrupted: { color: C.accentCoral, ...T.meta },
    cancelBtn: { alignSelf: 'flex-start', paddingVertical: S.x2, paddingHorizontal: S.x4, borderRadius: R.capsule, backgroundColor: C.card2 },
    cancelText: { color: C.ink2, ...T.meta },
    errText: { color: C.bad, ...T.meta },
    tabs: { flexDirection: 'row', gap: S.x2, paddingHorizontal: S.page, paddingTop: S.x3 },
    tabBtn: { flex: 1, height: 44, borderRadius: R.capsule, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
    tabOn: { backgroundColor: C.accent },
    tabText: { color: C.ink2, ...T.body },
    tabTextOn: { color: C.onAccent, fontWeight: '600' },
  });
