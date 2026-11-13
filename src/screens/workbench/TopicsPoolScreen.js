import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';

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

// 假数：结构与 pool_db.py 的 pool_topics 表一致
const DEFAULT_BOARDS = [
  { board: '商业与变现', n: 8 },
  { board: '内容创作', n: 6 },
  { board: 'AI 与工具', n: 5 },
  { board: '心理与人性', n: 7 },
  { board: '语言与思维', n: 4 },
  { board: '国学与哲学', n: 3 },
  { board: '身心与生活', n: 3 },
  { board: '权谋与政治', n: 2 },
];

const mkDims = (a, b, c) => {
  const d = {};
  DIM_KEYS.forEach((k, i) => (d[k] = 40 + ((i * 13 + a * 7) % 60)));
  d[DIM_KEYS[a % 10]] = 80 + b;
  d[DIM_KEYS[(a + 3) % 10]] = 75 + c;
  return d;
};

const DEFAULT_TOPICS = [
  { id: 't1', day: '2026-11-12', board: '商业与变现', title: '把「能力表达」当产品做，而不是当日记写', angle: '同一套能力，换个说法就能卖上价，差别不在能力而在表达结构。', hook: '你写的每一篇，都在替自己报价。', score: 91, status: 'idea', source_kind: '推文', source_ref: 'draft_2026-11-03_clean', dims: mkDims(2, 8, 5) },
  { id: 't2', day: '2026-11-12', board: '商业与变现', title: '先收钱再交付，比先交付再收钱多活三年', angle: '现金流不是财务问题，是谈判位置问题。', hook: '欠款不是客户变坏了，是你给了他可以拖的位置。', score: 78, status: 'writing', source_kind: '直播', source_ref: 'live_2026-11-08', dims: mkDims(5, 6, 4) },
  { id: 't3', day: '2026-11-12', board: '内容创作', title: '日更断掉的人，问题从来不是没时间', angle: '断更的真正原因是选题库存见底，写作能力从来不是瓶颈。', hook: '你不缺写的能力，你缺的是明天写什么。', score: 86, status: 'idea', source_kind: '推文', source_ref: 'draft_2026-10-28_hook', dims: mkDims(1, 7, 6) },
  { id: 't4', day: '2026-11-12', board: '内容创作', title: '开头三秒决定完播，但决定开头的是标题', angle: '完播率的病根在选题阶段，不在剪辑台。', hook: '你剪得再快，也救不回一个没人想点开的标题。', score: 74, status: 'published', source_kind: '抖音文案', source_ref: 'douyin_2026-11-05', dims: mkDims(7, 5, 3) },
  { id: 't5', day: '2026-11-12', board: 'AI 与工具', title: '把模型当实习生用，别当专家用', angle: '用它做初稿和整理，别让它替你做判断。', hook: '它写得比你快，但它不知道什么值得写。', score: 88, status: 'idea', source_kind: '推文', source_ref: 'draft_2026-11-09_ai', dims: mkDims(3, 9, 5) },
  { id: 't6', day: '2026-11-12', board: '心理与人性', title: '拖延不是懒，是怕做完之后发现自己不行', angle: '拖延保护的是自我评价，不是身体休息。', hook: '你不是不想做，你是不敢知道结果。', score: 82, status: 'idea', source_kind: '书', source_ref: 'book_拖延心理学_03', dims: mkDims(4, 6, 7) },
];

function fmt(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function top3(dims) {
  return DIM_KEYS.map((k) => [k, Number((dims || {})[k]) || 0])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
}

export default function TopicsPoolScreen({
  topics = DEFAULT_TOPICS,
  boards = DEFAULT_BOARDS,
  minScore = 75,
  activeTab = 'workbench',
  onBack,
  onTabPress,
  onRefreshAll,
  onRefreshBoard,
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
  const [draft, setDraft] = useState(null); // { id, text, streaming, error }
  const [busy, setBusy] = useState(null); // { done, total, current }
  const [note, setNote] = useState(null);
  const [follow, setFollow] = useState(true); // 流式是否自动跟随

  const scrollRef = useRef(null);
  const abortRef = useRef(null);
  const followRef = useRef(true);
  followRef.current = follow;

  // 离开页面（组件卸载）时不能让它静默继续跑
  useEffect(() => () => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

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

  const guardBusy = () => (busy ? '正在出题，等这一轮跑完再动' : null);

  const refreshAll = useCallback(() => {
    if (busy) return;
    Alert.alert(
      '刷新全部板块？',
      `会调用 ${boards.length} 次模型，约 6–12 分钟。期间可以点「取消」，取消后已出的选题保留。`,
      [
        { text: '先不刷', style: 'cancel' },
        {
          text: '开始',
          onPress: () => {
            if (!onRefreshAll) {
              setNote('接口还没接：onRefreshAll 没传进来');
              return;
            }
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            abortRef.current = ctrl;
            setNote(null);
            setBusy({ done: 0, total: boards.length, current: '' });
            Promise.resolve(
              onRefreshAll({
                signal: ctrl ? ctrl.signal : undefined,
                onProgress: (p) => setBusy({ done: p.done || 0, total: p.total || boards.length, current: p.current || '' }),
              }),
            )
              .then((res) => {
                if (res && res.added != null) setNote(`新增 ${res.added} 条${res.lowDropped ? `，${res.lowDropped} 条低于 ${minScore} 分丢掉` : ''}`);
              })
              .catch((e) => setNote(e && e.name === 'AbortError' ? '已取消，已出的选题保留' : '这一轮没跑完：' + String((e && e.message) || e)))
              .finally(() => {
                setBusy(null);
                abortRef.current = null;
              });
          },
        },
      ],
    );
  }, [busy, boards.length, minScore, onRefreshAll]);

  const cancelRefresh = () => {
    if (abortRef.current) abortRef.current.abort();
    setBusy(null);
  };

  const goBack = () => {
    if (busy) {
      Alert.alert('正在出题，确定离开吗？', '走了这一轮就取消，已经出来的选题会保留。', [
        { text: '留下', style: 'cancel' },
        { text: '离开并取消', style: 'destructive', onPress: () => { cancelRefresh(); onBack && onBack(); } },
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
            {t.angle ? <Text style={s.detailBody} allowFontScaling={false}>{t.angle}</Text> : null}
            {t.hook ? (
              <Text style={s.detailHook} allowFontScaling={false}>
                <Text style={{ color: K.brand }}>开头 · </Text>
                {t.hook}
              </Text>
            ) : null}

            <Text style={s.dims} allowFontScaling={false}>
              {top3(t.dims).map(([k, v], i) => `${i ? ' · ' : ''}${k.slice(0, 3)} ${v}`).join('')}
            </Text>
            <Text style={s.source} allowFontScaling={false}>
              来源 {t.source_kind || '未知'} · {String(t.source_ref || '').slice(0, 18)}
            </Text>

            <View style={s.actions}>
              <Pressable
                style={[s.btn, s.btnPrimary]}
                onPress={() => (d ? setDraft(null) : aiWrite(t, false))}
                accessibilityRole="button"
              >
                <Text style={[s.btnText, { color: C.onAccent }]} allowFontScaling={false}>
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
    <View style={s.root}>
      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: onTabPress ? dockPadding(insets, S) : S.page + insets.bottom }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
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
              选题池
            </Text>
            <Text style={s.subTitle} numberOfLines={1} allowFontScaling={false}>
              今天 {fmt(todayN)} 条 · 只看 {minScore} 分以上
            </Text>
          </View>
        </View>

        {/* 刷新全部板块：主操作。生成中按钮变进度，右侧给取消 */}
        <View style={s.actionRow}>
          <Pressable
            style={[s.mainBtn, busy ? s.mainBtnBusy : null]}
            onPress={refreshAll}
            disabled={!!busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!busy, busy: !!busy }}
          >
            <Text style={[s.mainBtnText, busy ? { color: K.brand } : null]} numberOfLines={1} allowFontScaling={false}>
              {busy ? `正在出题 ${busy.done}/${busy.total}${busy.current ? ' · ' + busy.current : ''}` : '刷新全部板块'}
            </Text>
          </Pressable>
          {busy ? (
            <Pressable style={s.cancelBtn} onPress={cancelRefresh} accessibilityRole="button" accessibilityLabel="取消生成">
              <Text style={s.cancelText} allowFontScaling={false}>
                取消
              </Text>
            </Pressable>
          ) : null}
        </View>

        {note ? (
          <Text style={s.note} allowFontScaling={false}>
            {note}
          </Text>
        ) : null}

        {/* 板块 chips：满宽出血横滚，最后一枚被屏缘裁掉一截 */}
        <View style={s.chipWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: S.page, gap: S.x2 }}
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
            还没有选题。点上面的「刷新全部板块」。
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
    statusRow: { flexDirection: 'row', gap: S.x2, marginTop: S.x3, marginHorizontal: S.page },
    chip: {
      height: 32,
      paddingHorizontal: S.x3,
      borderRadius: R.capsule,
      backgroundColor: C.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipOn: { backgroundColor: K.brand },
    chipText: { color: C.ink2, ...T.meta },
    chipTextOn: { color: K.onBrand, fontWeight: '500' },

    group: { marginTop: S.x6 },
    groupHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: S.x2,
      marginHorizontal: S.page,
      marginBottom: S.x3,
    },
    groupTitle: { color: C.ink, ...T.section },
    groupCount: { color: C.ink2, ...T.meta },
    groupEmpty: { marginHorizontal: S.page, color: C.ink3, ...T.meta },

    rowWrap: { marginHorizontal: S.page, marginBottom: S.x3, backgroundColor: C.card, borderRadius: R.small, overflow: 'hidden' },
    row: {
      minHeight: ROW_MIN_H,
      backgroundColor: 'transparent',
      padding: S.x4,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: S.x3,
    },
    scoreBox: { width: 56, alignItems: 'flex-start' },
    scoreNum: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
    scoreLvl: { marginTop: S.x1, color: C.ink2, ...T.meta },
    rowTitle: { flex: 1, color: C.ink, ...T.title },
    rowStatus: { flexShrink: 0, minWidth: 24, textAlign: 'right', ...T.meta, fontWeight: '500', marginTop: S.x1 },

    detail: { paddingHorizontal: S.x4, paddingTop: S.x3, paddingBottom: S.x4 },
    detailBody: { color: C.ink2, ...T.body },
    detailHook: { marginTop: S.x1, color: C.ink, ...T.body },
    dims: { marginTop: S.x3, color: C.ink2, ...T.meta },
    source: { marginTop: S.x1, color: C.ink3, ...T.meta },
    actions: { flexDirection: 'row', gap: S.x2, marginTop: S.x3 },
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
      right: S.page,
      height: 32,
      paddingHorizontal: S.x3,
      borderRadius: R.capsule,
      backgroundColor: C.hero,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toLatestText: { color: C.onHero, ...T.meta, fontWeight: '500' },
  });
