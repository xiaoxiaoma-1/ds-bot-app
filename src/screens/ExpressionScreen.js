import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useKeyboardShift, useKeyboardShiftJS } from '../keyboard';
import { expressionApi } from '../botApi';
import { readEventStream } from '../sse';
import { getBase, getSess } from '../store';

// 表达训练（老板 2026-11-13 定：说完再标，不做实时着色、不做 WebView、不加原生模块）。
// 阶段一输入纯文本黑字；点「讲完了」用本地 analyze 的 highlight 出词级标注 + 四个数字，
// 同时后台发 realtime；润色 / 点评 都是点了才发请求，点评走 SSE 边生成边显示。

// 词级三段颜色是老板给的原值；下划线形态受 RN 的 Text 限制（见交付说明）
const SPAN = {
  filler: { color: '#ff6b6b', textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: '#ff6b6b' },
  hedge: { color: '#ffa94d' },
  vague: { color: '#ffd43b', textDecorationLine: 'underline', textDecorationStyle: 'dashed', textDecorationColor: '#ffd43b' },
};

// 四个数字的颜色按老板给的顺序：笼统 / 填充 / 犹豫 / 密度
const STATS = [
  { k: 'vague', label: '笼统', color: '#ff6b6b' },
  { k: 'fillers', label: '填充', color: '#ffa94d' },
  { k: 'hedges', label: '犹豫', color: '#ffd43b' },
  { k: 'density', label: '密度', color: '#69db7c' },
];

const SPAN_RE = /<span class="(vague|filler|hedge)">([\s\S]*?)<\/span>/g;
const MARK_CAP = 2000; // 标色最多吃这么多字，其余按纯文本跟在后面

const HISTORY_KEY = '@expression_train_history_v1';
const HISTORY_MAX = 30;

function timeText(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 句级标注：后端 /api/expression/marks 给 golden / cut，前端统一成 gold / cut。
async function fetchMarks(text, signal) {
  const base = await getBase();
  const sess = await getSess();
  if (!base || !sess) return [];
  const res = await fetch(String(base).replace(/\/+$/, '') + '/api/expression/marks', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + sess, 'content-type': 'application/json' },
    body: JSON.stringify({ fullText: text }),
    credentials: 'include',
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false || !Array.isArray(data.marks)) return [];
  return data.marks
    .map((m) => ({
      ...m,
      kind: m.kind === 'golden' ? 'gold' : m.kind,
    }))
    .filter((m) => (m.kind === 'gold' || m.kind === 'cut') && m.text);
}

// 后端给的是已经拼好 span 的 HTML（不转义、不按分词），这儿只做「切成片段」，
// 不在前端重写标色规则。切不出片段就整段当纯文本，不报错。
function parseHighlight(html) {
  const segs = [];
  let last = 0;
  let m;
  SPAN_RE.lastIndex = 0;
  const src = String(html || '');
  while ((m = SPAN_RE.exec(src))) {
    if (m.index > last) segs.push({ text: src.slice(last, m.index), cls: null });
    segs.push({ text: m[2], cls: m[1] });
    last = m.index + m[0].length;
  }
  if (last < src.length) segs.push({ text: src.slice(last), cls: null });
  return segs;
}

// 超 2000 字：只给前 2000 字上色，其余纯文本跟后面
function capSegs(segs) {
  const out = [];
  let used = 0;
  let cut = false;
  for (const g of segs) {
    if (used >= MARK_CAP) {
      cut = true;
      out.push({ text: g.text, cls: null });
      continue;
    }
    const room = MARK_CAP - used;
    if (g.text.length <= room) {
      out.push(g);
      used += g.text.length;
    } else {
      out.push({ text: g.text.slice(0, room), cls: g.cls });
      out.push({ text: g.text.slice(room), cls: null });
      used = MARK_CAP;
      cut = true;
    }
  }
  return { segs: out, cut };
}

// 标注版整段：segs 不变就不重渲染。父组件每次流式 flush 都会重渲染，
// 这一层 memo 挡住的正是「约 2000 个 span 子节点被反复走一遍」——那才是 1600 个 delta 卡死的来源。
const DocText = memo(function DocText({ segs, style }) {
  return (
    <Text style={style} allowFontScaling={false}>
      {segs.map((g, i) =>
        g.cls ? (
          <Text key={i} style={SPAN[g.cls]}>
            {g.text}
          </Text>
        ) : (
          g.text
        ),
      )}
    </Text>
  );
});

// 点评 Markdown：只认四种语法——「## 」标题、**加粗**、行首「- 」列表项、\n 换行。
// 不引第三方库，自己解析。必须按整篇解析：chunks 是按 200 字硬切的，
// 分块渲染会把 ** 和行首「- 」切在两个块里，标记就渲染不出来。
const MD_HEAD = /^ {0,3}##[ \t]+(.+)$/;
const MD_ITEM = /^ {0,3}-[ \t]+(.+)$/;
const MD_BOLD = /\*\*([^*]+)\*\*/g;

// 行内加粗：返回「纯字符串 / 加粗 Text」混合数组送给外层 Text
function mdInline(text, style, key) {
  const out = [];
  let last = 0;
  let m;
  MD_BOLD.lastIndex = 0;
  while ((m = MD_BOLD.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <Text key={`${key}-${m.index}`} style={[style, { fontWeight: '600' }]} allowFontScaling={false}>
        {m[1]}
      </Text>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// 逐行定块：h 标题 / li 列表 / p 段落 / sp 空行
function mdBlocks(text) {
  return String(text || '')
    .split('\n')
    .map((line, i) => {
      const head = line.match(MD_HEAD);
      if (head) return { t: 'h', k: i, text: head[1] };
      const item = line.match(MD_ITEM);
      if (item) return { t: 'li', k: i, text: item[1] };
      return line.trim() ? { t: 'p', k: i, text: line.trim() } : { t: 'sp', k: i };
    });
}

// 点评渲染：整篇文本变了才重解析（useMemo + memo 双层，流式 flush 不会重复解析同一份文本）
const MdText = memo(function MdText({ text, style }) {
  const base = StyleSheet.flatten(style) || {};
  const blocks = useMemo(() => mdBlocks(text), [text]);
  const size = base.fontSize || 15;
  const lh = base.lineHeight || 21;
  return (
    <View style={{ gap: 4 }}>
      {blocks.map((b, idx) => {
        if (b.t === 'sp') {
          return idx === blocks.length - 1 ? null : <View key={b.k} style={{ height: 4 }} />;
        }
        if (b.t === 'h') {
          return (
            <Text
              key={b.k}
              style={[style, { fontWeight: '600', fontSize: size * 1.22, lineHeight: lh * 1.35, marginTop: idx > 0 ? 6 : 0 }]}
              allowFontScaling={false}
            >
              {mdInline(b.text, style, b.k)}
            </Text>
          );
        }
        if (b.t === 'li') {
          return (
            <View key={b.k} style={{ flexDirection: 'row', paddingLeft: 2 }}>
              <Text style={style} allowFontScaling={false}>
                •{' '}
              </Text>
              <Text style={[style, { flex: 1 }]} allowFontScaling={false}>
                {mdInline(b.text, style, b.k)}
              </Text>
            </View>
          );
        }
        return (
          <Text key={b.k} style={style} allowFontScaling={false}>
            {mdInline(b.text, style, b.k)}
          </Text>
        );
      })}
    </View>
  );
});

// 训练历史单条：左滑露出「删除」，点删除才真正删。参考微信消息左滑。
function HistoryRow({ item, s, onDelete }) {
  const tx = useRef(new Animated.Value(0)).current;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        onMoveShouldSetPanResponderCapture: (e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (e, g) => {
          if (g.dx < 0) tx.setValue(Math.max(-96, g.dx));
        },
        onPanResponderRelease: (e, g) => {
          const opened = g.dx < -56;
          Animated.spring(tx, {
            toValue: opened ? -96 : 0,
            useNativeDriver: false,
            tension: 420,
            friction: 20,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(tx, { toValue: 0, useNativeDriver: false, tension: 420, friction: 20 }).start();
        },
      }),
    [tx],
  );

  return (
    <View style={s.historyItem}>
      <View style={s.historyDelete}>
        <Pressable onPress={() => onDelete && onDelete(item.id)} accessibilityRole="button" accessibilityLabel="删除这条训练记录">
          <Text style={s.historyDeleteText} allowFontScaling={false}>删除</Text>
        </Pressable>
      </View>
      <Animated.View {...responder.panHandlers} style={[s.historyRow, { transform: [{ translateX: tx }] }]}>
        <View style={s.historyTop}>
          <Text style={s.historyTime} allowFontScaling={false}>{item.at}</Text>
          <Text style={s.historyScore} allowFontScaling={false}>
            {item.score === null || item.score === undefined ? '未评' : item.score}
          </Text>
        </View>
        <Text style={s.historySummary} numberOfLines={1} allowFontScaling={false}>
          {item.summary}
        </Text>
      </Animated.View>
    </View>
  );
}

export default function ExpressionScreen({ onBack }) {
  const { C, T, S, R } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();
  const kbShift = useKeyboardShift();
  const kbShiftJS = useKeyboardShiftJS();

  const [stage, setStage] = useState('input'); // input | marked
  const [draft, setDraft] = useState('');
  const [a, setA] = useState(null); // analyze 返回
  const [analyzeMs, setAnalyzeMs] = useState(null); // 端到端耗时，显示出来当时长证据
  const [segs, setSegs] = useState([]);
  const [cut, setCut] = useState(false);
  const [tab, setTab] = useState('orig'); // orig | polish | report
  const [polish, setPolish] = useState({ loading: false, text: '', err: null });
  // 点评：流式。text 只往后拼，chars 是已收字数，interrupted 表示没等到 done
  const [report, setReport] = useState({ streaming: false, chunks: [], chars: 0, err: null, interrupted: false });
  const [err, setErr] = useState(null);
  const [sentMarks, setSentMarks] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(HISTORY_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setHistory(parsed.slice(0, HISTORY_MAX));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const addHistory = useCallback((rec) => {
    setHistory((prev) => {
      const next = [rec, ...prev.filter((x) => x && x.id !== rec.id)].slice(0, HISTORY_MAX);
      AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const deleteHistory = useCallback((id) => {
    setHistory((prev) => {
      const next = prev.filter((x) => x && x.id !== id);
      AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const inputScrollRef = useRef(null);
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

  const canFinish = draft.trim().length >= 10 && stage === 'input';

  const finish = useCallback(async () => {
    const text = draft.trim();
    if (!text || stage !== 'input') return;
    const t0 = Date.now();
    stickRef.current = true;
    setStage('marked');
    setTab('orig');
    setErr(null);
    setA(null);
    setAnalyzeMs(null);
    setSegs([]);
    setSentMarks([]);
    setPolish({ loading: false, text: '', err: null });
    setReport({ streaming: false, text: '', chars: 0, err: null, interrupted: false, chunks: [] });
    try {
      const d = await expressionApi.analyze(text);
      setA(d);
      const parsed = capSegs(parseHighlight(d.highlight));
      setSegs(parsed.segs);
      setCut(parsed.cut);
      setAnalyzeMs(Date.now() - t0);
      addHistory({
        id: `${Date.now()}`,
        at: timeText(),
        summary: text.replace(/\s+/g, ' ').slice(0, 20),
        score: typeof d.density === 'number' ? d.density : null,
      });
      // 金句 / 可删是独立模型接口，慢一点，不挡 analyze 首屏。
      fetchMarks(text).then((marks) => setSentMarks(marks)).catch(() => {});
    } catch (e) {
      setErr(e.message);
    }
  }, [draft, stage, addHistory]);

  const runPolish = useCallback(() => {
    setTab('polish');
    if (polish.text || polish.loading) return;
    setPolish({ loading: true, text: '', err: null });
    expressionApi
      .polish(draft.trim())
      .then((d) => setPolish({ loading: false, text: d.polished || '', err: null }))
      .catch((e) => setPolish({ loading: false, text: '', err: e.message }));
  }, [polish.text, polish.loading, draft]);

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
      body: { fullText: draft.trim(), stats },
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
  }, [report.streaming, report.chars, a, draft, pushDelta, flush]);

  const cancelReport = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    flush(true);
    // 已收到的内容保留，标成中断
    setReport((p) => ({ ...p, streaming: false, interrupted: Boolean(p.chars) }));
  }, [flush]);

  const backToInput = useCallback(() => {
    setStage('input');
  }, []);

  const statValue = (k) => {
    if (!a) return '--';
    const v = a[k];
    return v === null || v === undefined ? '--' : String(v);
  };

  const onScroll = useCallback((e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    stickRef.current = distance < 48; // 离底部 48 以内才算「贴着底」
  }, []);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.head}>
        <Pressable onPress={stage === 'marked' ? backToInput : onBack} hitSlop={12}>
          <Text style={s.back} allowFontScaling={false}>
            返回
          </Text>
        </Pressable>
        <Text style={s.title} allowFontScaling={false}>
          表达训练
        </Text>
        <View style={s.headSlot} />
      </View>

      {stage === 'input' ? (
        <Animated.View style={[s.body, { paddingBottom: kbShiftJS }]}>
          <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
            <ScrollView
              ref={inputScrollRef}
              style={s.scrollFlex}
              contentContainerStyle={s.inputWrap}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => stickRef.current && inputScrollRef.current && inputScrollRef.current.scrollToEnd({ animated: false })}
            >
              <TextInput
                style={s.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="点这里，然后按键盘上的麦克风说话"
                placeholderTextColor={C.placeholder}
                multiline
                textAlignVertical="top"
                allowFontScaling={false}
                autoComplete="off"
                textContentType="none"
              />

              <View style={s.historyHead}>
                <Text style={s.historyTitle} allowFontScaling={false}>过往训练</Text>
                <Text style={s.historyCount} allowFontScaling={false}>{history.length} 条</Text>
              </View>
              {history.length === 0 ? (
                <Text style={s.historyEmpty} allowFontScaling={false}>还没有训练记录</Text>
              ) : (
                history.map((item) => (
                  <HistoryRow key={item.id} item={item} s={s} onDelete={deleteHistory} />
                ))
              )}
            </ScrollView>
          </TouchableWithoutFeedback>
          <Animated.View>
            <Text style={s.hint} allowFontScaling={false}>
              按键盘上的麦克风说，说完点讲完了
            </Text>
            <Pressable
              style={[s.primary, canFinish ? null : s.primaryOff, { marginBottom: Math.max(insets.bottom, S.x4) }]}
              onPress={finish}
              disabled={!canFinish}
            >
              <Text style={[s.primaryText, canFinish ? null : s.primaryTextOff]} allowFontScaling={false}>
                讲完了
              </Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      ) : (
        <Animated.View style={[s.body, { paddingBottom: kbShiftJS }]}>
          <ScrollView
            ref={scrollRef}
            style={s.scrollFlex}
            contentContainerStyle={s.markedWrap}
            onScroll={onScroll}
            scrollEventThrottle={64}
            keyboardShouldPersistTaps="handled"
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

            {err ? (
              <Pressable onPress={() => setErr(null)} style={s.errBox}>
                <Text style={s.errText} allowFontScaling={false}>
                  {err}
                </Text>
              </Pressable>
            ) : null}

            {a ? (
              <>
                <View style={s.docHead}>
                  <Text style={s.docHeadText} allowFontScaling={false}>
                    词级标注 · 用时 {analyzeMs === null ? '--' : analyzeMs + ' ms'}
                  </Text>
                  <Pressable onPress={backToInput} hitSlop={10}>
                    <Text style={s.docEdit} allowFontScaling={false}>
                      改一下
                    </Text>
                  </Pressable>
                </View>
                {cut ? (
                  <Text style={s.cutNote} allowFontScaling={false}>
                    超过 {MARK_CAP} 字，之后的内容按纯文本显示（不再标色）
                  </Text>
                ) : null}
                <DocText segs={segs} style={s.doc} />

                {/* 句级（金句 / 可删）：数据源目前没有，sentMarks 为空时一个字都不渲染 */}
                {sentMarks.length > 0 ? (
                  <View style={s.sentBox}>
                    {sentMarks.map((m, i) => (
                      <View key={i} style={s.sentRow}>
                        <Text
                          style={[s.sentText, m.kind === 'gold' ? s.sentGoldLine : s.sentCutLine]}
                          allowFontScaling={false}
                        >
                          {m.text}
                        </Text>
                        <Text style={s.sentTag} allowFontScaling={false}>
                          {m.kind === 'gold' ? '金句' : '可删'}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
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
                      {draft.trim()}
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
                  <Pressable onPress={cancelReport} style={s.cancelBtn} hitSlop={8}>
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
        </Animated.View>
      )}
    </View>
  );
}

const makeStyles = (C, T, S, R) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    body: { flex: 1 },
    // 关键：RN flexShrink 默认为 0，不给 flex:1 时 ScrollView 按内容撑高，
    // 键盘弹起（body 被 paddingBottom 压缩）会把底部按钮/tabs 挤出可视区
    scrollFlex: { flex: 1 },
    head: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: S.page, gap: S.x3 },
    back: { color: C.ink2, ...T.body },
    title: { color: C.ink, ...T.title, flex: 1, textAlign: 'center' },
    headSlot: { width: 32 },
    inputWrap: { paddingHorizontal: S.page, paddingTop: S.x3, paddingBottom: S.x6, minHeight: 240 },
    input: { backgroundColor: C.card, borderRadius: R.small, padding: S.x4, color: C.ink, ...T.body, minHeight: 200 },
    historyHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: S.x6, marginBottom: S.x2 },
    historyTitle: { color: C.ink, ...T.title },
    historyCount: { color: C.ink3, ...T.meta },
    historyEmpty: { color: C.ink3, ...T.meta },
    historyItem: { marginTop: S.x2, borderRadius: R.small, overflow: 'hidden' },
    historyDelete: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 96, backgroundColor: C.bad, alignItems: 'center', justifyContent: 'center' },
    historyDeleteText: { color: '#FFFFFF', ...T.meta, fontWeight: '600' },
    historyRow: { backgroundColor: C.card, borderRadius: R.small, paddingHorizontal: S.x3, paddingVertical: S.x2 },
    historyTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    historyTime: { color: C.ink3, ...T.meta },
    historyScore: { color: C.accent, ...T.meta, fontWeight: '600' },
    historySummary: { marginTop: S.x1, color: C.ink, ...T.body },
    hint: { color: C.ink3, ...T.meta, paddingHorizontal: S.page, paddingTop: S.x2, paddingBottom: S.x3 },
    primary: {
      marginHorizontal: S.page,
      height: 56,
      backgroundColor: C.accent,
      borderRadius: R.capsule,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryOff: { backgroundColor: C.card2 },
    primaryText: { color: C.onAccent, ...T.title },
    primaryTextOff: { color: C.ink3 },
    markedWrap: { paddingHorizontal: S.page, paddingTop: S.x3, paddingBottom: S.x8 },
    statsRow: { flexDirection: 'row', gap: S.x2, marginBottom: S.x4 },
    statCell: { flex: 1, backgroundColor: C.card, borderRadius: R.small, paddingVertical: S.x3, alignItems: 'center', gap: S.x1 },
    statNum: { ...T.section },
    statLabel: { color: C.ink3, ...T.meta },
    docHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: S.x2 },
    docHeadText: { color: C.ink3, ...T.meta },
    docEdit: { color: C.accent, ...T.meta },
    cutNote: { color: C.ink3, ...T.meta, marginBottom: S.x2 },
    doc: { color: C.ink, ...T.body, lineHeight: 26 },
    sentBox: { marginTop: S.x4, gap: S.x2 },
    sentRow: { gap: S.x1 },
    sentText: { color: C.ink, ...T.body },
    sentGoldLine: { color: '#C8A24A', textDecorationLine: 'underline', textDecorationColor: '#C8A24A' },
    sentCutLine: { textDecorationLine: 'underline', textDecorationStyle: 'dashed', textDecorationColor: C.ink3 },
    sentTag: { color: '#C8A24A', ...T.meta },
    panel: { marginTop: S.x6, backgroundColor: C.card, borderRadius: R.small, padding: S.x4, gap: S.x2 },
    panelHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    panelTitle: { color: C.ink, ...T.title },
    panelMeta: { color: C.ink3, ...T.meta },
    panelLabel: { color: C.ink3, ...T.meta },
    panelOrig: { color: C.ink2, ...T.body },
    panelText: { color: C.ink, ...T.body },
    center: { alignItems: 'center', justifyContent: 'center', paddingVertical: S.x6, gap: S.x2 },
    centerText: { color: C.ink3, ...T.meta },
    interrupted: { color: C.accentCoral, ...T.meta },
    cancelBtn: { alignSelf: 'flex-start', paddingVertical: S.x2, paddingHorizontal: S.x4, borderRadius: R.capsule, backgroundColor: C.card2 },
    cancelText: { color: C.ink2, ...T.meta },
    errBox: { backgroundColor: C.card, borderRadius: R.small, padding: S.x3, marginBottom: S.x3 },
    errText: { color: C.bad, ...T.meta },
    tabs: { flexDirection: 'row', gap: S.x2, paddingHorizontal: S.page, paddingTop: S.x3 },
    tabBtn: { flex: 1, height: 44, borderRadius: R.capsule, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
    tabOn: { backgroundColor: C.accent },
    tabText: { color: C.ink2, ...T.body },
    tabTextOn: { color: C.onAccent, fontWeight: '600' },
  });
