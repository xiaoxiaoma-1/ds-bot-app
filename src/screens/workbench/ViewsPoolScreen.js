import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useEdgeBack from '../../components/useEdgeBack';
import LiveInput, { inputMaxHeight } from '../../components/LiveInput';
import { useTheme } from '../../theme';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';
import { getMyViews } from '../../workbenchApi';
import { readCached, setCached } from '../../cache';

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
const REVEAL_W = 132; // 滑出块宽度：放得下「认同」「不认同」两个大字，且不超过卡片的三分之一
const SWIPE_OUT = 420;
const THRESHOLD = 96;

const springIn = { tension: 420, friction: 20, useNativeDriver: false }; // 令牌 S3；pan.x 是 JS 驱动，弹簧必须同为 JS


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

  // 2026-11-15（老板）：这一屏只有一个形态 —— 上面卡片、下面「观点库 / 我的观点」两个气泡。
  // 以前有 menu 入口页，还被 autoSwipe 一进来就切走，所以老板永远看不到那两个气泡。
  const [mode, setMode] = useState('swipe');

  // 2026-11-15（老板）：「我的观点下面这个显示几条的，它怎么是个省略号」
  // 原来只有一个 null 初值 → 进页面那一瞬永远是「… 条」，网慢一点就停在省略号上，
  // 看起来像坏了。改成三件事：
  //   ① 先同步读缓存（MyViewsRoute 写的同一个键 'workbench:myviews'），有数就先显示真数；
  //   ② 读到之后写回缓存，下次进页面第一帧就是真数；
  //   ③ 只有「确实还没读到、也没有缓存」时才显示省略号，且最多停 1.2 秒，
  //      超时就当读不到处理（显示「— 条」），绝不留一个永远转不出来的省略号。
  const cachedMyViews = readCached('workbench:myviews');
  const [myTotal, setMyTotal] = useState(() => {
    // 三阶优先①缓存total；②本地items数组长度；③null（不显示）
    const t = cachedMyViews && Number(cachedMyViews.total);
    if (Number.isFinite(t) && t >= 0) return t;
    const items = cachedMyViews && cachedMyViews.items;
    if (Array.isArray(items)) return items.length;
    return null;
  });
  const [idx, setIdx] = useState(0);
  const [doneN, setDoneN] = useState(done);
  const [verdict, setVerdict] = useState(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [manual, setManual] = useState(false); // 无障碍兜底面板
  const [undoBusy, setUndoBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const moving = useRef(false);

  const pan = useRef(new Animated.ValueXY()).current;
  const asked = useRef(false);
  // 通则 36：停在第一条时点「观点库」原来是个空操作（界面什么都没变，像是没点中）。
  // 现在给一句话反馈，3 秒自己消失（通则 31）。
  const [firstHint, setFirstHint] = useState(false);
  const hintTimer = useRef(null);

  const cur = topics[idx] || null;
  const next = topics[idx + 1] || null;
  const remain = Math.max(0, left - (doneN - done));
  // 条数显示：有数就显示 ${n} 条，没数就什么都不显示（不再显示「…」和「—」）。
  const myCount = Number.isFinite(myTotal) && myTotal >= 0 ? String(myTotal) : null;

  const refreshMyCount = useCallback(async () => {
    try {
      const d = await getMyViews();
      const n = Number(d.total) || 0;
      setMyTotal(n);
      // 写回 MyViewsRoute 用的同一个缓存键，下次进页面第一帧就是真数，不再闪省略号。
      try {
        setCached('workbench:myviews', d);
      } catch {}
    } catch (e) {
      // 读取失败不影响页面主逻辑
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
        onPanResponderMove: (e, g) => {
          // 只有手指真的移动过才让滑出块出现（老板：静止时完全不显示）
          if (!moving.current) moving.current = true;
          if (Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2) setDragging(true);
          pan.setValue({ x: g.dx, y: g.dy });
        },
        onPanResponderRelease: (e, g) => {
          moving.current = false;
          setDragging(false);
          // 轻点不滑：展开详情整页（老板要的「点一下变成完整页面」）
          if (Math.abs(g.dx) <= 6 && Math.abs(g.dy) <= 6) {
            if (onOpenDetail && cur) onOpenDetail(cur);
            return;
          }
          // 老板 2026-11-15 的原话：「我左滑它这个地方是认同，右滑是一个不认同」
          // （之前的判定是反的：右滑成了认同、左滑成了不认同）
          if (g.vx <= -0.4 || g.dx <= -THRESHOLD) settle('agree');
          else if (g.vx >= 0.4 || g.dx >= THRESHOLD) settle('disagree');
          else springBack();
        },
        onPanResponderTerminate: () => {
          moving.current = false;
          setDragging(false);
          springBack();
        },
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
      setMyTotal((v) => (Number.isFinite(v) && v >= 0 ? v + 1 : v));
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
      });
    } catch (e) {
      setErr(String((e && e.message) || '没存上'));
    } finally {
      setBusy(false);
    }
  };

  // 探探式滑出块（2026-11-15 重做）：一块贴在卡片右边（认同）、一块贴左边（不认同）。
  // 静止时被卡片整个盖住（位移推到框外 + opacity 0），手指一动就跟着露出来，松手回弹归零。
  const agreeShift = pan.x.interpolate({ inputRange: [-THRESHOLD, 0], outputRange: [0, REVEAL_W], extrapolate: 'clamp' });
  const agreeOp = pan.x.interpolate({ inputRange: [-24, -8, 0], outputRange: [1, 0.5, 0], extrapolate: 'clamp' });
  const disagreeShift = pan.x.interpolate({ inputRange: [0, THRESHOLD], outputRange: [-REVEAL_W, 0], extrapolate: 'clamp' });
  const disagreeOp = pan.x.interpolate({ inputRange: [0, 8, 24], outputRange: [0, 0.5, 1], extrapolate: 'clamp' });
  const nextScale = pan.x.interpolate({ inputRange: [-THRESHOLD, 0, THRESHOLD], outputRange: [1, 0.96, 1], extrapolate: 'clamp' });
  const nextShift = pan.x.interpolate({ inputRange: [-THRESHOLD, 0, THRESHOLD], outputRange: [0, 8, 0], extrapolate: 'clamp' });

  const empty = !cur && !verdict;

  // 卡片高度按「这一屏实际剩下的高度」算（老板 2026-11-15：小屏上卡被裁一半）。
  // CARD_H=360 是大屏上限，不是死值：stage 是 flex:1，量到多少就用多少，上下各留 S.x4。
  const [stageH, setStageH] = useState(0);
  const stageHRef = useRef(0);
  // manualRow（认同/不认同/不确定 三个胶囊）也占 stage 的高度：44 + marginTop 12 = 56
  // 打开「用按钮代替滑动」时不减掉它，center 布局会把卡片上下双向顶出屏幕。
  const MANUAL_ROW_H = 44 + S.x3;
  const cardH = Math.max(200, Math.min(CARD_H, (stageH || CARD_H) - S.x4 * 2 - (manual ? MANUAL_ROW_H : 0)));
  // 字多字少跟着卡片高度走，卡片矮就少显示几行，不让正文溢出卡片
  const claimLines = cardH >= 340 ? 9 : cardH >= 280 ? 6 : 4;

  // 返回（通则 11）：写理由时先收 sheet，其余情况只退上一级。
  // 不再回「入口页」—— 入口页已经删掉，气泡就在这一屏底部。
  const goBack = () => {
    if (verdict) {
      setVerdict(null);
      setWhy('');
      setErr(null);
      pan.setValue({ x: 0, y: 0 });
      return;
    }
    if (onBack) onBack();
  };
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;

  // 两条右滑分开管，互不干扰：
  //   ① 在卡片上右滑 = 不认同（卡片自己的 responder，touch-start 就抢走）
  //   ② 贴屏幕最左边缘那条竖窄条往右滑 = 整页跟手退出（独立窄条，见下面的 edgeStrip）
  //
  // 2026-11-15 第四版（前三版都没生效）：不再靠「在祖先上抢 move 阶段」，
  // 改成在屏幕最左边铺一条 24px 宽的独立 View，它画在卡片之上、绝对定位，
  // 手指落进去时卡片不在命中路径里 —— 这是唯一可靠的办法。
  // 卡片宽 353、屏宽约 393，左右各留 20，所以 24 只吃到卡片最外 4px，不影响滑卡片。
  const EDGE_W = 24;
  const edgeBack = useEdgeBack({
    onBack: () => {
      if (goBackRef.current) goBackRef.current();
    },
    enabled: mode === 'swipe',
    edgeWidth: EDGE_W,
  });

  // 表态页（内层）不许原生边滑把整屏 pop 掉 —— 那正是「从观点库一路退回工作台」的来源。
  // 内层关掉原生手势，左滑交给上面的 edgeBack：只退一层，落到「选一个入口」。
  useEffect(() => {
    if (nav && nav.setOptions) nav.setOptions({ gestureEnabled: mode !== 'swipe' });
  }, [mode, nav]);

  // 安卓实体返回键同理：内层这一下先自己吃掉，走 goBack()，不让导航栈直接把整屏弹掉
  useEffect(() => {
    if (mode !== 'swipe') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (goBackRef.current) goBackRef.current();
      return true;
    });
    return () => {
      if (sub && sub.remove) sub.remove();
    };
  }, [mode]);


  const cancelVote = () => {
    setVerdict(null);
    setWhy('');
    setErr(null);
    pan.setValue({ x: 0, y: 0 });
  };

  // 「观点库」气泡：回到第一页（也就是首页那 3 条所在的位置），不换页、不跳走
  const toFirst = () => {
    if (idx === 0) {
      // 已经在第一条：不装死，给一句反馈
      setFirstHint(true);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setFirstHint(false), 3000);
      return;
    }
    setIdx(0);
    pan.setValue({ x: 0, y: 0 });
  };

  const openMine = () => {    if (onOpenMyViews) {
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



  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* 底衬层：跟手时不能露白 */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg }} />
      
      {/* 跟手动画层：整屏平移。
          注意：这一层**不挂** panHandlers —— 手势全部交给底下那条独立窄条。
          挂在这里会和卡片抢同一个 touch，前几版就是因为这个一直不生效。 */}
      <Animated.View 
        style={{ 
          flex: 1, 
          backgroundColor: C.bg,          // iOS 上给 View 加阴影必须有底色，否则阴影不渲染
          transform: [{ translateX: edgeBack.x }],
          shadowColor: '#000000',
          shadowOffset: { width: -6, height: 0 },
          shadowOpacity: 0.18,
          shadowRadius: 12,
        }}
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
        <View
          style={s.stage}
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            if (h > 0 && Math.abs(h - stageHRef.current) > 1) {
              stageHRef.current = h;
              setStageH(h);
            }
          }}
        >
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
            <View style={[s.stack, { height: cardH }]}>
              {next ? (
                <Animated.View style={[s.card, s.cardBack, { height: cardH }, { transform: [{ scale: nextScale }, { translateY: nextShift }] }]}>
                  <Text style={s.cardClaim} numberOfLines={claimLines} allowFontScaling={false}>
                    {next.claim}
                  </Text>
                </Animated.View>
              ) : null}

              {/* 滑出块：只有手指在拖的时候才挂到树上（老板：静止时完全不显示）。
                  贴卡片边缘、占满卡片高度、随 pan.x 平移露出、松手回弹。 */}
              {dragging ? (
                <View pointerEvents="none" style={s.revealClip}>
                <Animated.View
                  style={[
                    s.revealPane,
                    s.revealRight,
                    { opacity: agreeOp, transform: [{ translateX: agreeShift }] },
                  ]}
                >
                  <Text style={[s.revealText, { color: C.good }]} allowFontScaling={false}>
                    认同
                  </Text>
                </Animated.View>
                <Animated.View
                  style={[
                    s.revealPane,
                    s.revealLeft,
                    { opacity: disagreeOp, transform: [{ translateX: disagreeShift }] },
                  ]}
                >
                  <Text style={[s.revealText, { color: C.bad }]} allowFontScaling={false}>
                    不认同
                  </Text>
                </Animated.View>
              </View>
              ) : null}

              <Animated.View
                {...responder.panHandlers}
                style={[
                  s.card,
                  s.cardFront,
                  { height: cardH },
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
                <Text style={s.cardClaim} numberOfLines={claimLines} allowFontScaling={false}>
                  {cur.claim}
                </Text>
                <Text style={s.cardAuthor} numberOfLines={1} allowFontScaling={false}>
                  @{cur.author || '来源未标'}
                </Text>
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

      {/* 页面下半：两个气泡入口（老板 2026-11-15 明确要求「下面得有两个气泡，一个观点库一个我的观点」）。
          以前这两个入口藏在被 autoSwipe 直接切走的 menu 页里，所以他一直看不到。 */}
      {verdict ? null : (
        <View style={s.entryRow}>
          <Pressable
            style={s.entryBubble}
            onPress={toFirst}
            accessibilityRole="button"
            accessibilityLabel={`观点库，还剩 ${remain} 条`}
          >
            <Text style={s.entryTitle} allowFontScaling={false}>
              观点库
            </Text>
            <Text style={s.entrySub} numberOfLines={1} allowFontScaling={false}>
              {empty ? '全看完了' : loading ? '正在读…' : firstHint ? '已经在第一条' : `还剩 ${remain} 条`}
            </Text>
          </Pressable>
          <Pressable
            style={s.entryBubble}
            onPress={openMine}
            accessibilityRole="button"
            accessibilityLabel={`我的观点${myCount ? ', ' + myCount + ' 条' : ''}`}
          >
            <Text style={s.entryTitle} allowFontScaling={false}>
              我的观点
            </Text>
            <Text style={s.entrySub} numberOfLines={1} allowFontScaling={false}>
              {myCount ? myCount + ' 条' : ''}
            </Text>
          </Pressable>
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
          <LiveInput
            style={s.input}
            minHeight={72}
            maxHeight={inputMaxHeight(21, 5, 16)}
            padVertical={16}
            value={why}
            onChangeText={(v) => {
              setWhy(v);
              if (err) setErr(null);
            }}
            placeholder="写一句为什么，它跟你有什么关系"
            placeholderTextColor={C.placeholder}
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
      </Animated.View>

      {/* 屏幕最左边缘的手势窄条（2026-11-15 第四版）。
          为什么要一条独立窄条：卡片自己在 touch-start 就抢走 responder（本文件的
          onStartShouldSetPanResponder），挂在祖先上靠 move 阶段去抢在真机上不可靠。
          这条窄条画在卡片之上、绝对定位，手指落进来时卡片根本不在命中路径里，
          所以它能稳稳拿到 touch-start，两条手势不会再打架。
          它跟着页面一起平移，所以滑出去时不会挡住下一页。
          上边界往下让 60（insets.top + 60），避开左上角那个返回按钮，不然会把按钮左半边吃掉。 */}
      {mode === 'swipe' && !verdict ? (
        <Animated.View
          style={[s.edgeStrip, { top: insets.top + 60, transform: [{ translateX: edgeBack.x }] }]}
          {...edgeBack.panHandlers}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (C, T, S, R, K) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },

    // 屏幕最左边缘的手势窄条：绝对定位、画在最上层、透明（不挡视线）。
    // 宽度必须和 useEdgeBack 的 edgeWidth 一致（都用 EDGE_W = 24）。
    edgeStrip: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 24,
      zIndex: 30,
    },

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
    // 高度不再固定：JSX 里按 stage 量到的实际高度给（小屏不裁卡）
    stack: { width: 353 },
    card: {
      position: 'absolute',
      left: 0,
      top: 0,
      width: 353,
      borderRadius: R.big,
      backgroundColor: C.card,
      padding: S.x5,
      overflow: 'hidden',
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
    // 滑出块（探探式）：整块贴在卡片边缘，占满卡片高度，静止时被推到框外看不见
    revealClip: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', borderRadius: R.big },
    revealPane: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: REVEAL_W,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.card2,
    },
    revealRight: { right: 0 },
    revealLeft: { left: 0 },
    revealText: { ...T.section, fontWeight: '700' },

    emptyBox: { alignItems: 'center', gap: S.x2, paddingHorizontal: S.x5 },
    emptyTitle: { color: C.ink, ...T.section },
    emptySub: { color: C.ink2, ...T.meta, textAlign: 'center' },

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
    // 高度交给 LiveInput（72 ~ 5 行+padding），这里只管长相
    input: { marginTop: S.x3, flexShrink: 1, backgroundColor: C.card2, borderRadius: R.small, padding: S.x4, color: C.ink, ...T.body },
    errText: { marginTop: S.x2, color: C.bad, ...T.meta },
    sheetActions: { marginTop: S.x3, flexDirection: 'row', justifyContent: 'flex-end', gap: S.x2 },
    ghostBtn: { height: 44, paddingHorizontal: S.x4, borderRadius: R.capsule, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
    ghostText: { color: C.ink, ...T.title },
    saveBtn: { height: 44, paddingHorizontal: S.x5, borderRadius: R.capsule, backgroundColor: K.brand, alignItems: 'center', justifyContent: 'center' },
    saveText: { color: K.onBrand, ...T.title },
    sheetNote: { marginTop: S.x2, color: C.ink3, ...T.meta },

    // 下半两个气泡入口：全圆胶囊（通则 18），字号按 34/11 的差距拉开
    entryRow: {
      flexDirection: 'row',
      gap: S.x3,
      marginHorizontal: S.page,
      marginBottom: S.x4,
    },
    entryBubble: {
      flex: 1,
      height: 64,
      borderRadius: R.capsule,
      backgroundColor: C.card,
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingHorizontal: S.x5,
      gap: S.x1,
    },
    entryTitle: { color: C.ink, ...T.title },
    entrySub: { color: C.ink2, ...T.meta },

    hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.x3, marginHorizontal: S.page, marginBottom: S.x2 },
    hint: { color: C.ink3, ...T.meta, flexShrink: 1 },
    undoText: { color: K.brand, ...T.meta, fontWeight: '500' },
  });
