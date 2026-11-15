import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';
import { getTopicsRefreshStatus, startTopicsRefresh } from '../../workbenchApi';
import { readCached, setCached } from '../../cache';

// 选题池页（2026-11-12）
// 口径：功能 1:1 复刻电脑端 TopicsPanel，界面重做。数据源 pool_db.py / index.js 的 pool 路由。
//
// 总经理已批的界面决定：
//   ① 板块 chips 横向滚动，不换行 → 满宽出血，最后一枚被屏幕右缘裁掉一截，暗示还能滑
//   ② 不放模型选择器（手机换模型是危险操作，且看不出差别）
//   ③ 第一版只做「AI 写」，「我来写」不出现（手机长文输入痛苦，宁缺毋滥）
//   ④ 流式出稿：用户没手动上滑时自动跟随；上滑后右下角出「回到最新」，点了恢复跟随
//   ⑤ 刷新全部板块（8 次模型调用）必须先二次确认、可取消、离开页面要确认
//   ⑥ 列表行只放三项：评分 + 标题 + 状态；角度/钩子/Top3/来源/操作全在点开的详情里
//
// props（本页不直接打接口：网络与 key 归 api.js，这边只出交互）
//   topics     [{ id, board, title, angle, hook, dims, score, level, why, status, source_kind, source_ref, day }]
//   boards     [{ board, n }]            8 个固定板块 + 条数
//   minScore   number                    低于此分不显示（电脑端默认 75）
//   activeTab / onTabPress / onBack
//   onRefreshAll({ onProgress, signal })                 整轮 8 板块，onProgress({done,total,current})
//   onRefreshBoard(board, { signal })                    单板块补题
//   onWriteDraft(topic, { rewrite, signal, onChunk })    流式出口播稿，onChunk(累计文本)
//   onChangeStatus(topic, nextStatus)
//   onDelete(topic)
//
// 颜色尺寸全取 theme.js 与令牌：字号 34/24/17/15/11，间距 4 的倍数，圆角 32/24/胶囊，零边框零投影。

const SHAPE_H = 196;
const ROW_MIN_H = 88; // 评分块 56 + 上下 16
const STATUS = [
  { key: 'idea', label: '想法' },
  { key: 'writing', label: '在写' },
  { key: 'published', label: '已发' },
];

const nextStatus = (s) => (s === 'idea' ? 'writing' : s === 'writing' ? 'published' : 'idea');
const statusLabel = (s) => (STATUS.find((x) => x.key === s) || STATUS[0]).label;
const lvlOf = (score) => (score >= 85 ? 'A' : score >= 70 ? 'B' : 'C');

// 右缘渐隐的 6 档：12pt 里每档 2pt，透明度递增到背景色
const FADE_STEPS = [0.15, 0.3, 0.45, 0.6, 0.78, 0.95];

const DIM_KEYS = ['普世性', '数字冲击', '反常识', '可操作', '痛点强度', '时效性', '争议空间', '经验可挂', '能落到动作', '标题性'];

function fmt(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function top3(dims) {
  return DIM_KEYS.map((k) => [k, Number((dims || {})[k]) || 0])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
}

export default function TopicsPoolScreen({
  topics = [],
  boards = [],
  minScore = 75,
  loading = false,
  error = null,
  activeTab = 'workbench',
  onBack,
  onTabPress,
  onRefreshAll,
  onWriteDraft,
  onChangeStatus,
  onDelete,
}) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);

  const [boardF, setBoardF] = useState('all');
  const [statusF, setStatusF] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [note, setNote] = useState(null);
  const [follow, setFollow] = useState(true); // 流式是否自动跟随
  // 2026-11-15（老板报「选题池点进去闪退」）：0.3.7 清死代码时把这两行连无关的 state
  // 一起删了，但 draft / setDraft / scrollRef 还在用（AI 写稿的内容与流式跟随滚动）。
  // parser 只查语法，查不出「用了没声明」——补回来。
  const [draft, setDraft] = useState(null); // { id, text, streaming, error }
  const scrollRef = useRef(null);

  const followRef = useRef(true);
  followRef.current = follow;

  // 服务端出题任务状态（唯一判据）
  // 2026-11-15（老板）：退出去再进来，刷新按钮会闪现 1 秒才切回「正在出题」。
  // 根因：job 初值是 null → running 算出 false → 第一帧先画了按钮；
  //       等 pullJob() 异步回来才发现真在跑，于是又切走。
  // 治法两条一起上：
  //   ① 首帧先用上次问到的状态（缓存同步读），本来就是 running 就直接画进度
  //   ② 还没问到过任何状态时（jobKnown=false）不画按钮，画一个同高的占位
  const JOB_CACHE = 'topics:job';
  const [job, setJob] = useState(() => readCached(JOB_CACHE) || null);
  const [jobKnown, setJobKnown] = useState(() => Boolean(readCached(JOB_CACHE)));
  const [jobBusy, setJobBusy] = useState(false);
  const jobDoneRef = useRef(false);
  const running = Boolean(job && job.running);

  const pullJob = useCallback(async () => {
    try {
      const d = await getTopicsRefreshStatus();
      setJob(d);
      setCached(JOB_CACHE, d);   // 下次进页面首帧就能直接用
      setJobKnown(true);
      return d;
    } catch (e) {
      // 读不到状态：把 known 也置真（否则按钮永远不出现），当作「没在跑」
      setJobKnown(true);
      return null;
    }
  }, []);

  // 进页面先问一次，之后每 3 秒问一次：退出再进来能接着看到同一条进度
  useEffect(() => {
    let alive = true;
    pullJob();
    const timer = setInterval(async () => {
      if (!alive) return;
      const d = await pullJob();
      if (d && d.state === 'done' && !jobDoneRef.current) {
        jobDoneRef.current = true;
        if (onRefreshAll) Promise.resolve(onRefreshAll({})).catch(() => {});
      }
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pullJob, onRefreshAll]);

  const shownAll = useMemo(() => topics.filter((x) => (x.score || 0) >= minScore), [topics, minScore]);
  const shown = useMemo(
    () =>
      shownAll
        .filter((x) => (boardF === 'all' ? true : (x.board || '未分板块') === boardF))
        .filter((x) => (statusF === 'all' ? true : x.status === statusF)),
    [shownAll, boardF, statusF],
  );

  // 分组：全部板块时按 boards 顺序分组，其余单组
  const groups = useMemo(() => {
    if (boardF !== 'all') return [{ board: boardF, items: shown.slice().sort((a, b) => (b.score || 0) - (a.score || 0)) }];
    const out = boards.map((b) => ({
      board: b.board,
      items: shown.filter((x) => (x.board || '') === b.board).sort((a, b) => (b.score || 0) - (a.score || 0)),
    }));
    const loose = shown.filter((x) => !boards.some((b) => b.board === x.board));
    if (loose.length) out.push({ board: '未分板块', items: loose, loose: true });
    return out;
  }, [boards, shown, boardF]);

  const todayN = shownAll.length;

  const guardBusy = () => (running ? '正在出题，等这一轮跑完再动' : null);

  // 2026-11-15（老板）：「只要今天这 30 条没出完，刷新全部板块就不该出现；出完了才出现；
  // 退出再进来 100 次也一样」。所以判据只有一个 —— 服务端 /api/topics/refresh/status，
  // 本地 state 不作为判据（它一会被清、一会是旧的，正是老板一直看到按钮的原因）。
  // 2026-11-15：0.3.7 把「二次确认」连同旧 state 一起删掉了，这里补回来 ——
  // 老板原话要看到「会调用 6 次模型，约 6~12 分钟，期间可以点取消」再决定。
  const refreshAll = useCallback(async () => {
    if (jobBusy || running) return;
    Alert.alert(
      '刷新全部板块？',
      '会调用 6 次模型，约 6–12 分钟。期间可以离开，进度在服务端继续跑；已经出的选题不会丢。',
      [
        { text: '先不刷', style: 'cancel' },
        {
          text: '开始',
          onPress: async () => {
            setJobBusy(true);
            setNote(null);
            try {
              const d = await startTopicsRefresh();
              setJob(d);
              // 刚点完刷新就把状态落缓存：马上退出再进来，首帧也能直接看到「正在出题」
              setCached(JOB_CACHE, d);
              setJobKnown(true);
              if (onRefreshAll) Promise.resolve(onRefreshAll({})).catch(() => {});
            } catch (e) {
              setNote('没能开始刷新：' + String((e && e.message) || e));
            } finally {
              setJobBusy(false);
            }
          },
        },
      ],
    );
  }, [jobBusy, running, onRefreshAll]);

  const goBack = () => {
    if (running) {
      Alert.alert('正在出题，先离开？', '这一轮在服务端继续跑，回来还看得到同一条进度；已经出的选题不会丢。', [
        { text: '留下', style: 'cancel' },
        { text: '离开', style: 'destructive', onPress: () => onBack && onBack() },
      ]);
      return;
    }
    onBack && onBack();
  };

  const toggleRow = (t) => {
    setOpenId((prev) => (prev === t.id ? null : t.id));
    if (openId === t.id) setDraft((d) => (d && d.id === t.id ? null : d));
  };

  // AI 写：流式。rewrite=true 时重写一遍
  const aiWrite = (t, rewrite) => {
    if (!onWriteDraft) {
      setDraft({ id: t.id, text: '', error: '接口还没接：onWriteDraft 没传进来' });
      return;
    }
    setFollow(true);
    setDraft({ id: t.id, text: '', streaming: true });
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    onWriteDraft(t, {
      rewrite: !!rewrite,
      signal: ctrl ? ctrl.signal : undefined,
      onChunk: (acc) => {
        setDraft((d) => (d && d.id === t.id ? { ...d, text: acc } : d));
        if (followRef.current && scrollRef.current) {
          // 跟随到底：内容在增长，滚到最大即视为贴住最新
          scrollRef.current.scrollToEnd({ animated: false });
        }
      },
    })
      .then(() => setDraft((d) => (d && d.id === t.id ? { ...d, streaming: false } : d)))
      .catch((e) => {
        setDraft((d) =>
          d && d.id === t.id
            ? { ...d, streaming: false, error: e && e.name === 'AbortError' ? '已停止' : String((e && e.message) || '写不出来') }
            : d,
        );
      });
  };

  const onScroll = (e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
    if (!atBottom && follow) setFollow(false);
    if (atBottom && !follow) setFollow(true);
  };

  const backToLatest = () => {
    setFollow(true);
    if (scrollRef.current) scrollRef.current.scrollToEnd({ animated: true });
  };

  const askDelete = (t) => {
    const g = guardBusy();
    if (g) return setNote(g);
    Alert.alert('删掉这条选题？', '删了找不回来，已写的稿子不跟着删。', [
      { text: '算了', style: 'cancel' },
      { text: '删', style: 'destructive', onPress: () => onDelete && onDelete(t) },
    ]);
  };

  const advance = (t) => {
    const g = guardBusy();
    if (g) return setNote(g);
    const next = nextStatus(t.status);
    onChangeStatus && onChangeStatus(t, next);
  };

  const renderRow = (t) => {
    const open = openId === t.id;
    const d = draft && draft.id === t.id ? draft : null;
    const lvl = t.level || lvlOf(t.score || 0);
    return (
      <View key={t.id} style={s.rowWrap}>
        <Pressable
          style={s.row}
          onPress={() => toggleRow(t)}
          accessibilityRole="button"
          accessibilityLabel={`${t.title}，${t.score} 分，${statusLabel(t.status)}`}
          accessibilityState={{ expanded: open }}
        >
          <View style={s.scoreBox}>
            <Text style={[s.scoreNum, { color: lvl === 'A' ? C.good : lvl === 'B' ? C.ink : C.ink2 }]} allowFontScaling={false}>
              {t.score == null ? '—' : t.score}
            </Text>
            <Text style={s.scoreLvl} allowFontScaling={false}>
              {lvl} 级
            </Text>
          </View>
          <Text style={s.rowTitle} numberOfLines={2} allowFontScaling={false}>
            {t.title}
          </Text>
          <Text style={[s.rowStatus, { color: t.status === 'published' ? C.good : C.ink2 }]} numberOfLines={1} allowFontScaling={false}>
            {statusLabel(t.status)}
          </Text>
        </Pressable>

        {open ? (
          <View style={s.detail}>
            {t.note ? <Text style={s.detailBody} allowFontScaling={false}>{t.note}</Text> : null}
            {t.hook ? (
              <Text style={s.detailHook} allowFontScaling={false}>
                <Text style={{ color: K.brand }}>开头 · </Text>
                {t.hook}
              </Text>
            ) : null}

            <Text style={s.dims} allowFontScaling={false}>
              {top3(t.dims).map(([k, v], i) => `${i ? ' · ' : ''}${k.slice(0, 3)} ${v}`).join('')}
            </Text>

            <View style={s.actions}>
              <Pressable
                style={[s.btn, s.btnPrimary]}
                onPress={() => (d ? setDraft(null) : aiWrite(t, false))}
                accessibilityRole="button"
              >
                <Text style={[s.btnText, { color: K.onBrand }]} allowFontScaling={false}>
                  {d ? '收起稿' : 'AI 写'}
                </Text>
              </Pressable>
              <Pressable style={s.btn} onPress={() => advance(t)} accessibilityRole="button">
                <Text style={s.btnText} allowFontScaling={false}>
                  标{statusLabel(nextStatus(t.status))}
                </Text>
              </Pressable>
              <Pressable style={s.btn} onPress={() => askDelete(t)} accessibilityRole="button">
                <Text style={s.btnText} allowFontScaling={false}>
                  删
                </Text>
              </Pressable>
            </View>

            {d ? (
              <View style={s.draftBox}>
                <View style={s.draftHead}>
                  <Text style={s.draftTag} allowFontScaling={false}>
                    AI 写的口播稿 · 只用原始素材里的事实
                  </Text>
                  {d.streaming ? null : (
                    <Pressable onPress={() => aiWrite(t, true)} hitSlop={8} accessibilityRole="button">
                      <Text style={s.draftRetry} allowFontScaling={false}>
                        重写一遍
                      </Text>
                    </Pressable>
                  )}
                </View>
                {d.error ? (
                  <Text style={[s.draftBody, { color: C.bad }]} allowFontScaling={false}>
                    写不出来：{d.error}
                  </Text>
                ) : d.text ? (
                  <Text style={s.draftBody} allowFontScaling={false}>
                    {d.text}
                    {d.streaming ? '▍' : ''}
                  </Text>
                ) : (
                  <Text style={[s.draftBody, { color: C.ink2 }]} allowFontScaling={false}>
                    正在读原始素材、起第一句…
                  </Text>
                )}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    // 2026-11-15：root 补上 insets.top，头部这块钉在安全区下面（以前是 0，
    // 标题和「今天 N 条」正好落在状态栏底下，被「10:13」压住切掉上半截）。
    <View style={[s.root, { paddingTop: insets.top }]}>
      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        // 头部固定：只有列表自己滚，标题不跟着走（通则 13 / 10）
        stickyHeaderIndices={[0]}
        contentContainerStyle={{ paddingBottom: onTabPress ? dockPadding(insets, S) : S.page + insets.bottom }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <View style={s.top}>
          <View style={s.shape} />
          <Pressable style={s.back} onPress={goBack} accessibilityRole="button" accessibilityLabel="返回">
            <Text style={s.backText} allowFontScaling={false}>
              ‹
            </Text>
          </Pressable>
          <View style={[s.headText, { top: S.x6 * 2 + S.x1 }]}>
            <Text style={s.title} allowFontScaling={false}>
              选题池
            </Text>
            <Text style={s.subTitle} numberOfLines={1} allowFontScaling={false}>
              今天 {fmt(todayN)} 条 · 只看 {minScore} 分以上
            </Text>
          </View>
        </View>

        {/* 刷新全部板块：主操作。生成中按钮变进度，右侧给取消 */}
        {/* 刷新全部板块：只有在「今天这 30 条已经出完」或「压根没在跑」时才出现。
            在跑的时候这块只显示真进度（服务端给的 done/total），按钮不出现（老板 2026-11-15 定的）。 */}
        {!jobKnown ? (
          // 还没问到过服务端状态：这块先占住位置，一个按钮都不画，
          // 避免「刷新按钮闪一下又被换掉」。
          <View style={[s.actionRow, { minHeight: 56 }]} />
        ) : running ? (
          <View style={s.actionRow}>
            <View style={s.jobBox}>
              <Text style={s.jobTitle} allowFontScaling={false}>
                正在出题 {job.done}/{job.total}
              </Text>
              <Text style={s.jobSub} numberOfLines={1} allowFontScaling={false}>
                {job.current || '电脑那边正在生成，出完这里会自己出现刷新按钮'}
              </Text>
            </View>
          </View>
        ) : (
          <View style={s.actionRow}>
            <Pressable
              style={[s.mainBtn, jobBusy ? s.mainBtnBusy : null]}
              onPress={refreshAll}
              disabled={jobBusy}
              accessibilityRole="button"
              accessibilityState={{ disabled: jobBusy, busy: jobBusy }}
            >
              <Text style={s.mainBtnText} numberOfLines={1} allowFontScaling={false}>
                {jobBusy ? '正在登记这一轮…' : '刷新全部板块'}
              </Text>
            </Pressable>
          </View>
        )}

        {note ? (
          <Text style={s.note} allowFontScaling={false}>
            {note}
          </Text>
        ) : null}
        {error ? (
          <Text style={s.note} allowFontScaling={false}>
            {error}
          </Text>
        ) : null}

        {/* 板块 chips：满宽出血横滚，最后一枚被屏缘裁掉一截 */}
        <View style={s.chipWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: S.page, gap: S.x3 }}
          style={s.chipScroll}
        >
          <Pressable style={[s.chip, boardF === 'all' ? s.chipOn : null]} onPress={() => setBoardF('all')} accessibilityRole="button">
            <Text style={[s.chipText, boardF === 'all' ? s.chipTextOn : null]} allowFontScaling={false}>
              全部板块 {fmt(shownAll.length)}
            </Text>
          </Pressable>
          {boards.map((b) => {
            const on = boardF === b.board;
            return (
              <Pressable key={b.board} style={[s.chip, on ? s.chipOn : null]} onPress={() => setBoardF(b.board)} accessibilityRole="button">
                <Text style={[s.chipText, on ? s.chipTextOn : null]} allowFontScaling={false}>
                  {b.board} {fmt(shownAll.filter((x) => (x.board || '') === b.board).length)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {/* 右缘渐隐 12pt：让边缘「渐出去」而不是硬切一刀（总经理 2026-11-12 定，A 方案） */}
        <View style={s.chipFade} pointerEvents="none">
          {FADE_STEPS.map((o, i) => (
            <View key={i} style={[s.fadeStep, { opacity: o }]} />
          ))}
        </View>
        </View>

        {/* 状态 chips：四项一行放得下，不滚 */}
        <View style={s.statusRow}>
          <Pressable style={[s.chip, statusF === 'all' ? s.chipOn : null]} onPress={() => setStatusF('all')} accessibilityRole="button">
            <Text style={[s.chipText, statusF === 'all' ? s.chipTextOn : null]} allowFontScaling={false}>
              全部
            </Text>
          </Pressable>
          {STATUS.map((st) => {
            const on = statusF === st.key;
            return (
              <Pressable key={st.key} style={[s.chip, on ? s.chipOn : null]} onPress={() => setStatusF(st.key)} accessibilityRole="button">
                <Text style={[s.chipText, on ? s.chipTextOn : null]} allowFontScaling={false}>
                  {st.label} {fmt(shownAll.filter((x) => x.status === st.key).length)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {shown.length ? groups.map((g) => (
          <View key={g.board} style={s.group}>
            <View style={s.groupHead}>
              <Text style={s.groupTitle} allowFontScaling={false}>
                {g.board}
              </Text>
              <Text style={s.groupCount} allowFontScaling={false}>
                {g.items.length ? `${g.items.length} 条` : '今天还没出题'}
              </Text>
            </View>
            {g.items.length ? (
              g.items.map(renderRow)
            ) : (
              <Text style={s.groupEmpty} allowFontScaling={false}>
                这个板块今天还没有达到 {minScore} 分的选题
              </Text>
            )}
          </View>
        )) : null}

        {!shown.length ? (
          <Text style={s.empty} allowFontScaling={false}>
            {loading ? '正在读取选题…' : '还没有选题。点上面的「刷新全部板块」。'}
          </Text>
        ) : null}
      </ScrollView>

      {/* 流式跟随：用户手动上滑后才出现 */}
      {!follow ? (
        <Pressable
          style={[s.toLatest, { bottom: insets.bottom + S.x2 + 64 + 26 + S.x2 }]}
          onPress={backToLatest}
          accessibilityRole="button"
        >
          <Text style={s.toLatestText} allowFontScaling={false}>
            回到最新
          </Text>
        </Pressable>
      ) : null}

      {onTabPress ? <Dock activeTab={activeTab} onTabPress={onTabPress} /> : null}
    </View>
  );
}

const makeStyles = (C, T, S, R, K) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    scroll: { flex: 1 },

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
      top: 0,
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

    // 主操作：全宽黑胶囊 56（令牌主操作按钮）
    actionRow: { flexDirection: 'row', marginTop: S.x4, marginHorizontal: S.page, gap: S.x2 },
    mainBtn: {
      flex: 1,
      height: 56,
      borderRadius: R.capsule,
      backgroundColor: C.hero,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: S.x5,
    },
    mainBtnBusy: { backgroundColor: C.card },
    // 出题进度（服务端真数）：占原本按钮的位置，按钮此时不出现
    jobBox: {
      flex: 1,
      height: 56,
      borderRadius: R.capsule,
      backgroundColor: C.card,
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingHorizontal: S.x5,
      gap: S.x1,
    },
    jobTitle: { color: C.ink, ...T.title },
    jobSub: { color: C.ink2, ...T.meta },
    mainBtnText: { color: C.onHero, ...T.title },
    cancelBtn: {
      height: 56,
      paddingHorizontal: S.x5,
      borderRadius: R.capsule,
      backgroundColor: C.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelText: { color: C.ink2, ...T.title },
    note: { marginTop: S.x3, marginHorizontal: S.page, color: C.ink2, ...T.meta },

    // 板块横滚：满宽出血（左右不留页边距），靠内层 padding 撑出 20
    chipWrap: { marginTop: S.x6, position: 'relative' },
    chipScroll: {},
    chipFade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 12, flexDirection: 'row' },
    fadeStep: { flex: 1, backgroundColor: C.bg },
    statusRow: { flexDirection: 'row', gap: S.x3, marginTop: S.x4, marginHorizontal: S.page },
    chip: {
      height: 32,
      paddingHorizontal: S.x3,
      borderRadius: R.capsule,
      backgroundColor: C.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipOn: { backgroundColor: K.brand },
    // 2026-11-15（老板：字太密、间距太少）：只动「气」与「气」之间的缝和行距，
    // 气泡本身的 minHeight / padding / 圆角一个都没改，所以大小不变。
    chipText: { color: C.ink2, ...T.meta, lineHeight: 20 },
    chipTextOn: { color: K.onBrand, fontWeight: '500', lineHeight: 20 },

    group: { marginTop: S.x6 + S.x4 },
    groupHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: S.x2,
      marginHorizontal: S.page,
      marginBottom: S.x4,
    },
    groupTitle: { color: C.ink, ...T.section },
    groupCount: { color: C.ink2, ...T.meta },
    groupEmpty: { marginHorizontal: S.page, color: C.ink3, ...T.meta },

    // 一条和一条之间 20（原来 12），一屏能看到的条数少一点，但每条都透气
    rowWrap: { marginHorizontal: S.page, marginBottom: S.x5, backgroundColor: C.card, borderRadius: R.small, overflow: 'hidden' },
    row: {
      minHeight: ROW_MIN_H,
      backgroundColor: 'transparent',
      padding: S.x4,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: S.x4,
    },
    scoreBox: { width: 56, alignItems: 'flex-start' },
    scoreNum: { fontSize: 24, lineHeight: 32, fontWeight: '700' },
    scoreLvl: { marginTop: S.x2, color: C.ink2, ...T.meta },
    rowTitle: { flex: 1, color: C.ink, ...T.title, lineHeight: 30 },
    rowStatus: { flexShrink: 0, minWidth: 24, textAlign: 'right', ...T.meta, fontWeight: '500', marginTop: S.x1 },

    detail: { paddingHorizontal: S.x4, paddingTop: S.x4, paddingBottom: S.x5 },
    detailBody: { color: C.ink2, ...T.body, lineHeight: 26 },
    detailHook: { marginTop: S.x2, color: C.ink, ...T.body, lineHeight: 26 },
    dims: { marginTop: S.x4, color: C.ink2, ...T.meta, lineHeight: 20 },
    source: { marginTop: S.x2, color: C.ink3, ...T.meta },
    actions: { flexDirection: 'row', gap: S.x3, marginTop: S.x4 },
    btn: {
      height: 32,
      paddingHorizontal: S.x3,
      borderRadius: R.capsule,
      backgroundColor: C.card2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnPrimary: { backgroundColor: K.brand },
    btnText: { color: C.ink, ...T.meta, fontWeight: '500' },

    draftBox: { marginTop: S.x3, padding: S.x3, borderRadius: R.small, backgroundColor: C.card2 },
    draftHead: { flexDirection: 'row', alignItems: 'center', gap: S.x2, marginBottom: S.x2 },
    draftTag: { flex: 1, color: C.ink2, ...T.meta },
    draftRetry: { color: K.brand, ...T.meta, fontWeight: '500' },
    draftBody: { color: C.ink, ...T.body },

    empty: { marginTop: S.x6, marginHorizontal: S.page, color: C.ink2, ...T.body },

    toLatest: {
      position: 'absolute',
      // 卡片左右各留 S.page，原来按钮也贴在这个 x 上，正好压在卡片右边缘。
      // 往里收 8，让它浮在卡片里侧，不和边线打架。
      right: S.page + S.x2,
      height: 32,
      paddingHorizontal: S.x3,
      borderRadius: R.capsule,
      backgroundColor: C.hero,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toLatestText: { color: C.onHero, ...T.meta, fontWeight: '500' },
  });
