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
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';
import { getMyViews } from '../../workbenchApi';

// 观点库页 · 先选入口，再左右滑（骨架版 · 2026-11-12）
// 右滑认同 / 左滑不认同。
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
//   ④ 右滑认同 / 左滑不认同；卡片上固定标注「← 不认同」「认同 →」
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

// error 可能是字符串，也可能是 Error（cache 层抛的原样）；统一取出一句能给人看的话
function errorText(e) {
  if (!e) return '';
  if (typeof e === 'string') return e;
  return e.message ? String(e.message) : String(e);
}

// 今日观点消息条（D4）：左滑露「认同」，右滑露「不认同」；点条本身进这条的表态页。
// 双向都要露，所以没有复用 SwipeRow（那个只露一侧的「删除」）。
const BAR_W = 96;
function IdeaBar({ item, index, s, onOpen }) {
  const tx = useRef(new Animated.Value(0)).current;
  const shownRef = useRef(null); // 'agree' | 'disagree' | null

  const snap = (side) => {
    shownRef.current = side;
    Animated.spring(tx, {
      toValue: side === 'agree' ? -BAR_W : side === 'disagree' ? BAR_W : 0,
      tension: 420,
      friction: 20,
      useNativeDriver: true,
    }).start();
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (e, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
        onMoveShouldSetPanResponderCapture: (e, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (e, g) => tx.setValue(Math.max(-BAR_W, Math.min(BAR_W, g.dx))),
        onPanResponderRelease: (e, g) => {
          if (Math.abs(g.dx) <= 6 && Math.abs(g.dy) <= 6) {
            snap(null);
            if (onOpen) onOpen(null);
            return;
          }
          if (g.dx <= -40) snap('agree');
          else if (g.dx >= 40) snap('disagree');
          else snap(null);
        },
        onPanResponderTerminate: () => snap(null),
      }),
    [tx, onOpen],
  );

  return (
    <View style={s.barClip}>
      <View style={s.barPanes} pointerEvents="box-none">
        <Pressable
          style={[s.barPane, s.barPaneLeft]}
          onPress={() => onOpen && onOpen('disagree')}
          accessibilityRole="button"
        >
          <Text style={s.barPaneText} allowFontScaling={false}>不认同</Text>
        </Pressable>
        <Pressable
          style={[s.barPane, s.barPaneRight]}
          onPress={() => onOpen && onOpen('agree')}
          accessibilityRole="button"
        >
          <Text style={s.barPaneText} allowFontScaling={false}>认同</Text>
        </Pressable>
      </View>
      <Animated.View {...responder.panHandlers} style={{ transform: [{ translateX: tx }] }}>
        <Pressable style={s.barRow} onPress={() => onOpen && onOpen(null)} accessibilityRole="button">
          <Text style={s.barIndex} allowFontScaling={false}>{index + 1}</Text>
          <Text style={s.barTitle} numberOfLines={2} allowFontScaling={false}>
            {(item && (item.title || item.claim || item.content)) || '（无标题）'}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export default function ViewsPoolScreen({
  topics = [],
  done = 0,
  left = 0,
  loading = false,
  error = null,
  onRetry,
  activeTab = 'workbench',
  onBack,
  onTabPress,
  onAnswer,
  onNeedMore,
  onUndo,
  onOpenDetail,
  onOpenMyViews,
  autoSwipe = false,
}) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);
  const nav = useNavigation();

  const [mode, setMode] = useState(() => (autoSwipe ? 'swipe' : 'menu')); // menu = 两个气泡；swipe = 左右滑
  
  // 带 selected 参数进来（autoSwipe=true）时，数据一到就自动进 swipe
  useEffect(() => {
    if (autoSwipe && mode === 'menu' && Array.isArray(topics) && topics.length > 0) {
      setMode('swipe');
    }
  }, [autoSwipe, topics, mode]);

  const [myTotal, setMyTotal] = useState(null);
  const [myErr, setMyErr] = useState(null);
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
  const pending = Math.max(0, Number(left) || 0);
  // 三种状态分开显示：读着是「…」，读失败是「—」，读到才是数字。
  // 之前只有一个「…」，getMyViews 一失败就永远停在这一屏（错误被 catch 吞了）。
  const myCount = myErr ? '—' : myTotal === null ? '…' : String(myTotal);

  const refreshMyCount = useCallback(async () => {
    try {
      const d = await getMyViews();
      setMyTotal(Number(d.total) || 0);
      setMyErr(null);
    } catch (e) {
      setMyErr((e && e.message) || '读取失败');
    }
  }, []);

  useEffect(() => {
    refreshMyCount();
  }, [refreshMyCount]);

  useEffect(() => {
    if (mode !== 'swipe') return;
    const remainLocal = topics.length - idx;
    if (remainLocal <= 5 && remainLocal > 0 && !asked.current && onNeedMore) {
      asked.current = true;
      Promise.resolve(onNeedMore()).catch(() => {});
    }
    if (remainLocal > 8) asked.current = false;
  }, [idx, topics.length, onNeedMore, mode]);

  const settle = useCallback(
    (v) => {
      setErr(null);
      setWhy('');
      // 先把卡片送出去，再切到理由 sheet；否则 setVerdict 会立刻卸载卡片，弹簧位移看不见。
      if (v === 'unsure') {
        setVerdict(v);
        return;
      }
      Animated.timing(pan, {
        toValue: { x: v === 'agree' ? SWIPE_OUT : -SWIPE_OUT, y: 0 },
        duration: 180,
        useNativeDriver: false,
      }).start(() => {
        pan.setValue({ x: 0, y: 0 });
        setVerdict(v);
      });
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
        onStartShouldSetPanResponderCapture: () => !verdict,
        onMoveShouldSetPanResponder: (e, g) => !verdict && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
        onMoveShouldSetPanResponderCapture: (e, g) => !verdict && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
        onPanResponderRelease: (e, g) => {
          // 轻点不滑：展开详情整页（老板要的「点一下变成完整页面」）
          if (Math.abs(g.dx) <= 6 && Math.abs(g.dy) <= 6) {
            if (onOpenDetail && cur) onOpenDetail(cur);
            return;
          }
          // 右滑认同，左滑不认同。
          if (g.vx >= 0.4 || g.dx >= THRESHOLD) settle('agree');
          else if (g.vx <= -0.4 || g.dx <= -THRESHOLD) settle('disagree');
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
      refreshMyCount();
      Animated.timing(pan, {
        toValue: { x: verdict === 'agree' ? SWIPE_OUT : -SWIPE_OUT, y: 0 },
        duration: 180,
        useNativeDriver: false,
      }).start(() => {
        pan.setValue({ x: 0, y: 0 });
        setVerdict(null);
        setWhy('');
        setIdx(0);
        setMode('menu');
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
  const menuPending = pending || topics.length;

  const goBack = () => {
    // 层级（D3）：投票页 → 观点库主页面；观点库主页面 → 上一级（全部入口）
    if (mode === 'swipe') {
      setVerdict(null);
      setWhy('');
      setErr(null);
      pan.setValue({ x: 0, y: 0 });
      setMode('menu');
      return;
    }
    if (onBack) onBack();
  };

  const cancelVote = () => {
    setVerdict(null);
    setWhy('');
    setErr(null);
    pan.setValue({ x: 0, y: 0 });
    setMode('menu');
  };

  const openMine = () => {
    if (onOpenMyViews) {
      onOpenMyViews();
      return;
    }
    if (nav && nav.navigate) nav.navigate('MyViews');
  };

  // 今日观点的 3 条：点/滑 → 直接进这一条的表态页（D4 / D5）
  const startVote = (item, withVerdict) => {
    const i = topics.findIndex((t) => t && item && t.id === item.id);
    setIdx(i >= 0 ? i : 0);
    setWhy('');
    setErr(null);
    pan.setValue({ x: 0, y: 0 });
    setVerdict(withVerdict || null);
    setMode('swipe');
  };

  const dayIdeas = Array.isArray(topics) ? topics.slice(0, 3) : [];

  if (mode === 'menu') {
    return (
      <View style={s.root}>
        <View style={s.top}>
          <View style={s.shape} />
          <Pressable style={[s.back, { top: insets.top }]} onPress={goBack} accessibilityRole="button" accessibilityLabel="返回">
            <Text style={s.backText} allowFontScaling={false}>‹</Text>
          </Pressable>
          <View style={[s.headText, { top: insets.top + S.x6 * 2 + S.x1 }]}>
            <Text style={s.title} allowFontScaling={false}>观点库</Text>
            <Text style={s.subTitle} numberOfLines={1} allowFontScaling={false}>选一个入口</Text>
          </View>
        </View>

        <View style={s.menuWrap}>
          {/* 今日观点：固定在观点库最上面，像消息条（D4）。
              左滑露「认同」，右滑露「不认同」，点条本身进这一条的表态页（D5）。 */}
          {dayIdeas.length ? (
            <View style={s.ideaBox}>
              <Text style={s.ideaHead} allowFontScaling={false}>今日观点</Text>
              {dayIdeas.map((it, i) => (
                <IdeaBar
                  key={(it && it.id) || 'day-' + i}
                  item={it}
                  index={i}
                  s={s}
                  onOpen={(verdictKey) => startVote(it, verdictKey)}
                />
              ))}
            </View>
          ) : null}

          <Pressable style={s.menuCard} onPress={() => setMode('swipe')} accessibilityRole="button">
            <Text style={s.menuTitle} allowFontScaling={false}>观点库</Text>
            <Text style={s.menuSub} allowFontScaling={false}>
              {loading ? '正在读…' : `还有 ${menuPending} 条待判定`}
            </Text>
            <Text style={s.menuHint} allowFontScaling={false}>点进来左右滑</Text>
          </Pressable>

          <Pressable style={s.menuCard} onPress={openMine} accessibilityRole="button">
            <Text style={s.menuTitle} allowFontScaling={false}>我的观点</Text>
            <Text style={s.menuSub} allowFontScaling={false}>{myErr ? '读不到' : myCount + ' 条'}</Text>
            <Text style={s.menuHint} allowFontScaling={false}>看我自己写的</Text>
          </Pressable>
        </View>

        {/* 三态分开：有错就说错在哪、能重试；真的 0 条才是空态 */}
        {error ? (
          <View style={s.menuStateRow}>
            <Text style={s.menuStateText} allowFontScaling={false}>{errorText(error)}</Text>
            {onRetry ? (
              <Pressable onPress={onRetry} hitSlop={10} accessibilityRole="button">
                <Text style={s.menuStateBtn} allowFontScaling={false}>重试</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {myErr ? (
          <View style={s.menuStateRow}>
            <Text style={s.menuStateText} allowFontScaling={false}>我的观点读不到：{myErr}</Text>
            <Pressable onPress={refreshMyCount} hitSlop={10} accessibilityRole="button">
              <Text style={s.menuStateBtn} allowFontScaling={false}>重试</Text>
            </Pressable>
          </View>
        ) : null}

        {onTabPress ? (
          <Dock activeTab={activeTab} onTabPress={onTabPress} />
        ) : (
          <View style={{ height: S.x3 + insets.bottom }} />
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={s.top}>
        <View style={s.shape} />
        <Pressable style={[s.back, { top: insets.top }]} onPress={goBack} accessibilityRole="button" accessibilityLabel="返回">
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
                  <Animated.Text style={[s.dirText, { opacity: leftOp, color: C.bad }]} allowFontScaling={false}>
                    ← 不认同
                  </Animated.Text>
                  <Animated.Text style={[s.dirText, { opacity: rightOp, color: C.good }]} allowFontScaling={false}>
                    认同 →
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
          <View style={s.sheetHead}>
            <Text style={[s.verdictBadge, { color: verdict === 'agree' ? C.good : verdict === 'disagree' ? C.bad : C.ink2 }]} allowFontScaling={false}>
              {verdict === 'agree' ? '认同' : verdict === 'disagree' ? '不认同' : '不确定'}
            </Text>
            <Text style={s.sheetTitle} allowFontScaling={false}>
              {verdict === 'agree' ? '你为什么认同？' : verdict === 'disagree' ? '你为什么不认同？' : '你为什么说不清？'}
            </Text>
          </View>
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
            placeholderTextColor={C.placeholder}
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

    menuWrap: { flex: 1, paddingHorizontal: S.page, paddingTop: S.x6, gap: S.x4 },
    // 今日观点消息条（D4）
    ideaBox: { gap: S.x2 },
    ideaHead: { color: C.ink2, ...T.meta },
    barClip: { borderRadius: R.small, overflow: 'hidden' },
    barPanes: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', justifyContent: 'space-between' },
    barPane: { width: BAR_W, height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: C.card2 },
    barPaneLeft: { alignItems: 'center' },
    barPaneRight: { alignItems: 'center' },
    barPaneText: { color: C.ink, ...T.meta, fontWeight: '600' },
    barRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: S.x2,
      padding: S.x3,
      backgroundColor: C.card,
      borderRadius: R.small,
    },
    barIndex: { minWidth: S.x4, color: C.ink3, ...T.meta, textAlign: 'right' },
    barTitle: { flex: 1, minWidth: 0, color: C.ink, ...T.body },
    menuCard: { height: 148, borderRadius: R.big, backgroundColor: C.card, padding: S.x5, justifyContent: 'center' },
    menuTitle: { color: C.ink, ...T.section },
    menuSub: { marginTop: S.x2, color: C.ink2, ...T.body },
    menuHint: { marginTop: S.x1, color: C.ink3, ...T.meta },
    menuStateRow: { paddingHorizontal: S.page, paddingTop: S.x4, flexDirection: 'row', alignItems: 'center', gap: S.x2, flexWrap: 'wrap' },
    menuStateText: { color: C.bad, ...T.meta, flexShrink: 1 },
    menuStateBtn: { color: C.ink, ...T.meta, fontWeight: '600' },

    sheetHead: { flexDirection: 'row', alignItems: 'center', gap: S.x2 },
    verdictBadge: { ...T.meta, fontWeight: '500' },

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
