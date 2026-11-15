import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LiveInput, { inputMaxHeight } from '../components/LiveInput';
import { useTheme } from '../theme';
import { useKeyboardShiftJS } from '../keyboard';
import { expressionApi } from '../botApi';
import { capSegs, parseHighlight } from './expressionShared';
import SwipeRow from './SwipeRow';

// 表达训练（老板 2026-11-13 定：说完再标，不做实时着色、不做 WebView、不加原生模块）。
// 2026-11-15 拆层：本页只剩「写 + 讲完了」；讲完后 analyze 一次，把结果推进点评表
// （ExpressionReviewScreen，独立栈层）。这样从点评表左滑 / 点返回，都只退到这一层，
// 不会像以前那样（同一个组件里的 stage 切换 + 栈里只有一层）一路退到工作台主页。
//
// 本页不做的事：不滚外层 ScrollView。输入框自己长到 5 行就停，多出来的字在框里滚，
// 页面和框都不许因为打字而动一下。

const HISTORY_KEY = '@expression_train_history_v1';
const HISTORY_MAX = 30;

function timeText(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 训练历史单条：左滑露出「删除」，点删除才真正删。
// 左滑逻辑抽到 src/screens/SwipeRow.js：96 只在那个文件里出现一次，
// 宽度 / clamp / toValue 三处各写一遍就是红块和卡片之间出缝的直接原因。
function HistoryRow({ item, s, onDelete, onOpen, onSwipeState, busy }) {
  return (
    <SwipeRow onDelete={() => onDelete && onDelete(item.id)} onSwipeState={onSwipeState} style={s.historyItem}>
      {/* 2026-11-15：这一行以前点不动 —— 「过往训练点不进去」就是它没有 onPress。
          现在点一下用这条的原文重新标注一次，再进点评表（标注结果不落盘，不会造假数据）。 */}
      <Pressable
        style={[s.historyRow, busy ? { opacity: 0.6 } : null]}
        onPress={() => onOpen && onOpen(item)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`打开这条过往训练：${item.summary || ''}`}
      >
        <View style={s.historyTop}>
          <Text style={s.historyTime} allowFontScaling={false}>{item.at}</Text>
          <Text style={s.historyScore} allowFontScaling={false}>
            {busy ? '正在标…' : item.score === null || item.score === undefined ? '未评' : item.score}
          </Text>
        </View>
        <Text style={s.historySummary} numberOfLines={1} allowFontScaling={false}>
          {item.summary}
        </Text>
      </Pressable>
    </SwipeRow>
  );
}

export default function ExpressionScreen({ onBack, onNext }) {
  const { C, T, S, R } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();
  const kbShiftJS = useKeyboardShiftJS();

  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState([]);
  const [err, setErr] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  // 左滑中：外层 ScrollView 停滚，手势全给这一行（F3）
  const [swiping, setSwiping] = useState(false);
  // 正在从「过往训练」重新打开的那一条（行内显示「正在标…」，防连点）
  const [openingId, setOpeningId] = useState(null);

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

  const canFinish = draft.trim().length >= 10 && !analyzing;

  // 点了立刻有反应：按钮立刻进「正在标注」，不让页面等在那儿什么都不发生。
  // 2026-11-15：这里开始记时间戳（tapAt / apiMs），点评表拿去做「打开用了多少 ms」，
  // 慢在哪一段（请求 or 渲染）就能直接看出来，不用猜。
  const finish = useCallback(async () => {
    const text = draft.trim();
    if (!text || analyzing) return;
    setAnalyzing(true);
    setErr(null);
    // 先收键盘再等标注：键盘动画和页面转场叠一起会显得很慢（实测接口 5~12ms，慢的是这一段）
    Keyboard.dismiss();
    const t0 = Date.now();
    try {
      const d = await expressionApi.analyze(text);
      const t1 = Date.now();
      const parsed = capSegs(parseHighlight((d && d.highlight) || ''));
      addHistory({
        id: `${Date.now()}`,
        at: timeText(),
        summary: text.replace(/\s+/g, ' ').slice(0, 20),
        // 原文一起存：不然「过往训练」点开只能看到 20 字摘要，打不开
        text,
        score: d && typeof d.density === 'number' ? d.density : null,
      });
      if (onNext) {
        onNext({ text, a: d, segs: parsed.segs, cut: parsed.cut, analyzeMs: t1 - t0, tapAt: t0 });
      }
    } catch (e) {
      setErr((e && e.message) || '标注失败');
    } finally {
      setAnalyzing(false);
    }
  }, [draft, analyzing, addHistory, onNext]);

  // 过往训练 → 点开这条（用存下来的原文重新标一次，再进点评表）
  const openHistory = useCallback(async (item) => {
    if (!item || openingId) return;
    const text = String(item.text || '').trim();
    if (!text) {
      setErr('这条是早期记录，只存了摘要、没存原文；重新说一遍再标');
      return;
    }
    setOpeningId(item.id);
    setErr(null);
    const t0 = Date.now();
    try {
      const d = await expressionApi.analyze(text);
      const t1 = Date.now();
      const parsed = capSegs(parseHighlight((d && d.highlight) || ''));
      if (onNext) {
        onNext({ text, a: d, segs: parsed.segs, cut: parsed.cut, analyzeMs: t1 - t0, tapAt: t0 });
      } else {
        setErr('打不开：上一层的 onNext 没接');
      }
    } catch (e) {
      setErr((e && e.message) || '打开失败');
    } finally {
      setOpeningId(null);
    }
  }, [onNext, openingId]);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
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

      <Animated.View style={[s.body, { paddingBottom: kbShiftJS }]}>
        <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
          <ScrollView
            style={s.scrollFlex}
            contentContainerStyle={s.inputWrap}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            // 左滑露删除时锁住外层滚动：不锁的话横滑的第一小段会被原生纵向手势吃掉（F3）
            scrollEnabled={!swiping}
          >
            {/* 打字不许带动页面：inputWrap 上不再有 onContentSizeChange -> scrollToEnd */}
            <LiveInput
              style={s.input}
              // 2026-11-15：原来 min 200 —— 空的时候是一块 200 高的空灰框，占掉小半屏。
              // 现在只留 3 行高度，写多少长多少，到 5 行停住（框内滚，页面不动）。
              minHeight={96}
              maxHeight={inputMaxHeight(21, 5, 16)}
              padVertical={16}
              value={draft}
              onChangeText={(v) => {
                setDraft(v);
                if (err) setErr(null);
              }}
              placeholder="点这里，然后按键盘上的麦克风说话"
              placeholderTextColor={C.placeholder}
              textAlignVertical="top"
              allowFontScaling={false}
              autoComplete="off"
              textContentType="none"
            />

            {err ? (
              <Pressable onPress={() => setErr(null)} style={s.errBox} accessibilityRole="button">
                <Text style={s.errText} allowFontScaling={false}>{err}</Text>
              </Pressable>
            ) : null}

            <View style={s.historyHead}>
              <Text style={s.historyTitle} allowFontScaling={false}>过往训练</Text>
              <Text style={s.historyCount} allowFontScaling={false}>{history.length} 条</Text>
            </View>
            {history.length === 0 ? (
              <Text style={s.historyEmpty} allowFontScaling={false}>还没有训练记录</Text>
            ) : (
              history.map((item) => (
                <HistoryRow
                  key={item.id}
                  item={item}
                  s={s}
                  onDelete={deleteHistory}
                  onOpen={openHistory}
                  onSwipeState={setSwiping}
                  busy={openingId === item.id}
                />
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
            {analyzing ? (
              <View style={s.primaryBusy}>
                <ActivityIndicator size="small" color={C.ink3} />
                <Text style={[s.primaryTextOff, { ...T.title }]} allowFontScaling={false}>
                  正在标注…
                </Text>
              </View>
            ) : (
              <Text style={[s.primaryText, canFinish ? null : s.primaryTextOff]} allowFontScaling={false}>
                讲完了
              </Text>
            )}
          </Pressable>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const makeStyles = (C, T, S, R) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    body: { flex: 1 },
    // 关键：RN flexShrink 默认为 0，不给 flex:1 时 ScrollView 按内容撑高，
    // 键盘弹起（body 被 paddingBottom 压缩）会把底部按钮挤出可视区
    scrollFlex: { flex: 1 },
    head: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: S.page, gap: S.x3 },
    back: { color: C.ink2, ...T.body },
    title: { color: C.ink, ...T.title, flex: 1, textAlign: 'center' },
    headSlot: { width: 32 },
    // 输入框高度交给 LiveInput 钳（min 96 ≈ 3 行，最多 5 行后框内滚）
    inputWrap: { paddingHorizontal: S.page, paddingTop: S.x3, paddingBottom: S.x6 },
    // 高度：LiveInput 按内容钳（min 200 = 设计高度；到上限后框内自滚，框和页面都不动）
    input: { backgroundColor: C.card, borderRadius: R.small, padding: S.x4, color: C.ink, ...T.body },
    historyHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: S.x6, marginBottom: S.x2 },
    historyTitle: { color: C.ink, ...T.title },
    historyCount: { color: C.ink3, ...T.meta },
    historyEmpty: { color: C.ink3, ...T.meta },
    // 裁剪交给 SwipeRow 内部的普通 View，这里不再 overflow:hidden（那正是红块画出去的原因）
    historyItem: { marginTop: S.x2 },
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
    primaryBusy: { flexDirection: 'row', alignItems: 'center', gap: S.x2 },
    primaryText: { color: C.onAccent, ...T.title },
    primaryTextOff: { color: C.ink3 },
    errBox: { marginTop: S.x3, backgroundColor: C.card, borderRadius: R.small, padding: S.x3 },
    errText: { color: C.bad, ...T.meta },
  });
