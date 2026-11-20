import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import {
  charsLabel,
  loadBoardSummary,
  loadDraftResume,
  loadHotDaily,
  loadTopics,
} from '../homeData';
import { buildGreetingAndDate } from '../greeting';
import { postExplain } from '../workbenchApi';
import { dockPadding } from './workbench/Dock';
import { setCached, useCachedResource } from '../cache';

const BOARD_STATUS = [
  // 【2026-11-20 补「构思」】原来只有四栏，老板在手机上找不到自己提过的构思卡
  // （灵光思路、帮我管都在「构思」里），原话「没有这个栏是吧？我说我怎么找不到这个东西呢」。
  // 看板本身是五栏（构思/待完成/进行中/阶段完成/已完成），手机端必须跟看板一致。
  { key: 'idea', label: '构思' },
  { key: 'todo', label: '待完成' },
  { key: 'doing', label: '进行中' },
  { key: 'stage', label: '阶段完成' },
  { key: 'done', label: '已完成' },
];

// 三张卡等高的**下限**。A1：今日热点是基准，它自己不定高（由内容决定），
// 另外两张用 onLayout 量出来的热点实际高度对齐 —— 不许反过来把热点压小。
const HERO_MIN_H = 220;

export default function HomeScreen({ active = true, onOpenDraft, navigation }) {
  const { C, T, S, R } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();
  const { greeting, dateText } = useMemo(() => buildGreetingAndDate(), []);
  const heroCardW = Math.max(0, winWidth - S.page * 2 - S.x3);
// 状态胶囊等宽（2026-11-15 起）：boardCell 原来只有 flex:1，
// 但「待完成 32」和「进行中 0」文字长短不同，实际宽度跟着文字走 → 一排宽窄不一。
// 改成按容器宽度算一个死宽（容器 = 屏宽 − 左右 page − sectionCard 内距 − 间隙）。
// 【2026-11-20 修】原来除数写死 /4，加到 5 栏后总宽超出屏幕，第 5 个被切在屏幕外、那排又不能滑
// （老板原话「最后一个出去屏幕外了还划不动，这个才是重点」）。
// 改成按 BOARD_STATUS.length 动态算，以后再加栏也不会溢出。
const boardCellW = Math.max(
  0,
  (winWidth - S.page * 2 - S.x4 * 2 - S.x2 * (BOARD_STATUS.length - 1)) / BOARD_STATUS.length,
);
  const heroSnap = heroCardW + S.x3;

  const manualRefresh = useRef(false);
  const board = useCachedResource('home:board', loadBoardSummary, { refreshOnMount: !manualRefresh.current });
  const hot = useCachedResource('home:hot:list', loadHotDaily, { refreshOnMount: !manualRefresh.current });
  const draft = useCachedResource('home:draft', loadDraftResume, { refreshOnMount: !manualRefresh.current });
  const topics = useCachedResource('home:topics', loadTopics, { refreshOnMount: !manualRefresh.current });

  const [refreshing, setRefreshing] = useState(false);
  // B2：热点条目原地展开（不是跳页），同时只开一条
  const [hotOpen, setHotOpen] = useState(-1);
  // 方案 A（老板 2026-11-15 选定）：气泡里的「AI 怎么看」要真干活 ——
  // 原来那个按钮的 onPress 只是 setHotOpen(index)（等于什么都没做），底下还挂着「接口待接入」。
  // 现在直接调已有的 /api/dsh-media/explain（workbenchApi.postExplain），就地把解读摊在气泡下面。
  const [hotAi, setHotAi] = useState(null); // { index, loading, text, err }
  // A1：三张卡高度取最大值。量的是每张卡的内容区（不含标题/内边距），
  // 量到更大的就把三张的内容区一起抬到那个高度 —— 高度由内容撑开，但谁也不许比谁矮。
  const [heroBodyH, setHeroBodyH] = useState(0);
  const heroBodyMax = useRef(0);
  const measureHeroBody = useCallback((e) => {
    const h = (e && e.nativeEvent && e.nativeEvent.layout && e.nativeEvent.layout.height) || 0;
    if (!(h > 0)) return;
    // 只涨不缩：小卡被抬到大卡高度后再量回来还是同一个值，不会来回抖
    if (h > heroBodyMax.current + 0.5) {
      heroBodyMax.current = h;
      setHeroBodyH(h);
    }
  }, []);

  const loadAll = useCallback(async () => {
    manualRefresh.current = true;
    try {
      const [b, h, d, i, t] = await Promise.all([
        loadBoardSummary(),
        loadHotDaily(),
        loadDraftResume(),
        loadTopics(),
      ]);
      setCached('home:board', b);
      setCached('home:hot:list', h);
      setCached('home:draft', d);
      setCached('home:topics', t);
    } catch {
      // 保留旧数据，失败不打断当前页面
    }
    manualRefresh.current = false;
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadAll().finally(() => setRefreshing(false));
  }, [loadAll]);

  const go = useCallback((name, params) => {
    if (navigation && navigation.navigate) navigation.navigate(name, params);
  }, [navigation]);

  const b = board.data;
  const h = hot.data;
  const d = draft.data;
  const tp = topics.data;

  const hotItems = h && Array.isArray(h.head) && h.head.length
    ? h.head // 数据层已经给了 head（前 5 条）
    : (h && h.picked ? [h.picked] : []);
  const topicItems = (tp && Array.isArray(tp.items)) ? tp.items.slice(0, 10) : [];

  // 选题池行数：5 条填不满今日热点的高度，有 10 条就显示 10 条（老板说 5 或 10 都行）。
  // 6–9 条按实际条数显示；不足 5 条补齐 5 行占位，不让卡片缩成一小截。
  // 2026-11-15（老板）：不要求凑 10 条，能挤几条挤几条，密度合适就行。
  // 行距放宽到 24（原来 4），因此每行更高；行数按「卡片可用高度 / 行高」算，
  // 但最多不超过手上真有的条数 —— 绝不为了填满而编行。
  const TOPIC_ROW_H = 24; // 每行占的高度（含行距）：正文 21 + 呼吸 3
  const topicCap = Math.max(4, Math.floor((HERO_MIN_H - 60) / TOPIC_ROW_H)); // 220-60=160 → 6 行
  const topicRowCount = Math.min(topicCap, topicItems.length);
  const topicShow = topicRowCount;

  // 选题池右上角的数字：今天生成了几条（不是全表累计的 133）。
  // 今天还没出题（today=0）时不写「0 条」——池子里明明有东西，写 0 就是假数；
  // 改成说清「列表里这是哪一批」。
  const topicsMeta = !tp
    ? '去挑一个'
    : (Number.isFinite(tp.today) && tp.today > 0
        ? `今天 ${tp.today} 条 ›`
        : (Number.isFinite(tp.latestCount) && tp.latestCount > 0
            ? `${String(tp.latestDay || '').slice(5)} 那批 ${tp.latestCount} 条 ›`
            : '去挑一个'));

  // 接着写只认我自己写的稿子（数据层把 origin/table 都对齐到 my_drafts 才算 mine）。
  // 以前只看 id 有没有，结果把采集来的别人文案当自己的稿子显示了出来。
  const draftMine = Boolean(d && d.mine);

  const openDraft = () => {
    go('MyViews');
  };

  const openBoard = (status) => go('Board', status ? { status } : undefined);


  // B2：热点条目点开 = 卡片里原地展开一栏，两项：「查看原文」「AI 怎么看」
  const openHotItem = (index, it) => {
    setHotOpen((prev) => (prev === index ? -1 : index));
    // 换一条 / 收起时把上一条的 AI 解读一起收掉，不许串到另一条上
    setHotAi(null);
    if (!it) return;
    // 展开时把原文也顺手标一下，方便「查看原文」直接用
    return it;
  };

  // 通则 2 / 4：再点同一行收起、点旁边空白也收起
  const closeHot = useCallback(() => {
    setHotOpen(-1);
    setHotAi(null);
  }, []);

  // 「AI 怎么看」：调 explain 接口，行内显示。三态齐全（loading / error / 有字）。
  const askAi = useCallback(async (index, it) => {
    if (!it) return;
    const title = String(it.title || '').trim();
    if (!title) {
      setHotAi({ index, loading: false, text: '', err: '这条没有标题，问不了' });
      return;
    }
    setHotAi({ index, loading: true, text: '', err: null });
    try {
      const out = await postExplain(
        `这条热点：${title}${it.source ? `（来源 ${it.source}）` : ''}。\n它真正的重点是什么？和一个普通人有什么关系？`,
      );
      setHotAi((prev) => (prev && prev.index === index ? { index, loading: false, text: out, err: null } : prev));
    } catch (e) {
      setHotAi((prev) =>
        prev && prev.index === index
          ? { index, loading: false, text: '', err: (e && e.message) || '没问到' }
          : prev,
      );
    }
  }, []);

  const openHot = () => {
    go('HotDaily');
  };

  const scoreFor = (topic) => {
    if (topic && topic.score !== null && topic.score !== undefined && topic.score !== '') {
      const n = Number(topic.score);
      if (Number.isFinite(n)) return n + ' 分';
    }
    if (tp && tp.minScore !== null && tp.minScore !== undefined) {
      const n = Number(tp.minScore);
      if (Number.isFinite(n)) return n + ' 分';
    }
    return '—';
  };

  const StateLine = ({ st, empty }) =>
    st && st.loading ? (
      <View style={s.stateRow}>
        <ActivityIndicator color={C.accent} />
        <Text style={s.stateText} allowFontScaling={false}>正在取</Text>
      </View>
    ) : (
      <Text style={s.stateText} allowFontScaling={false}>
        {st && st.error ? '数据没来：' + st.error : empty}
      </Text>
    );

  const ErrorBlock = ({ st }) => (
    <View style={s.centerBlock}>
      <Text style={s.stateText} allowFontScaling={false}>数据没来：{st && st.error ? st.error : '未知错误'}</Text>
      <Pressable onPress={loadAll} style={s.retryBtn} accessibilityRole="button">
        <Text style={s.retryText} allowFontScaling={false}>重试</Text>
      </Pressable>
    </View>
  );

  const HeroCard = ({ title, meta, children, onPress, label }) => (
    <Pressable
      style={[s.heroCard, { width: heroCardW }]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? label : undefined}
    >
      <View style={s.heroHead}>
        <Text style={s.heroTitle} allowFontScaling={false}>{title}</Text>
        <Text style={s.heroMeta} allowFontScaling={false}>{meta}</Text>
      </View>
      {/* A1：三张卡的内容区共用同一个 minHeight（取三张量出来的最大值），
          标题区和内边距三张一模一样，所以总高度必然相等，且内容多的那张撑开、不被压。 */}
      <View
        style={[s.heroBody, heroBodyH ? { minHeight: heroBodyH } : null]}
        onLayout={measureHeroBody}
      >
        {children}
      </View>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + S.x4,
          paddingBottom: dockPadding(insets, S),
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.ink2} />
        }
      >
        {/* 通则 2：热点气泡开着时，点旁边空白就收起。内层按钮/热点行会自己吃掉点击，
            这一层只接「真的点在空白上」的那一下。 */}
        <Pressable onPress={closeHot} style={s.hotBlank}>
        <View style={s.head}>
          <Text style={s.greeting} allowFontScaling={false}>{greeting}</Text>
          <Text style={s.date} allowFontScaling={false}>{dateText}</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={heroSnap}
          snapToAlignment="start"
          nestedScrollEnabled
          contentContainerStyle={s.heroRow}
        >
          <HeroCard
            title={h && !h.isToday && h.date ? h.date + ' 热点' : '今日热点'}
            // 卡里只放 5 行（和其它两张卡等高），所以标注只能写渲染出来的 5 条，
            // 多出来的用「还有 N 条 ›」提示；以前直接写总数，看着像卡里少了东西。
            meta={
              h && hotItems.length
                ? (h.items && h.items.length > hotItems.length
                  ? `${hotItems.length} 条 · 还有 ${h.items.length - hotItems.length} 条 ›`
                  : `${hotItems.length} 条 ›`)
                : '每天更新'
            }
            onPress={openHot}
            label="查看热点"
          >
            {hot.loading && !h ? (
              <StateLine st={hot} empty="正在取热点" />
            ) : hot.error && !h ? (
              <ErrorBlock st={hot} />
            ) : hotItems.length === 0 ? (
              <Text style={s.stateText} allowFontScaling={false}>今天的热点还没生成</Text>
            ) : (
              // 固定5行高度：不足5条时补空 View，保持等高
              [...Array(5)].map((_, index) => {
                const it = index < hotItems.length ? hotItems[index] : null;
                const open = hotOpen === index && it;
                return (
                  <View key={'hot-' + index + '-' + (it ? (it.url || it.title) : 'empty')}>
                    <Pressable
                      style={s.listRow}
                      onPress={() => (it ? openHotItem(index, it) : null)}
                      disabled={!it}
                      accessibilityRole={it ? 'button' : undefined}
                    >
                      <Text style={s.ordinal} allowFontScaling={false}>{index + 1}</Text>
                      {it ? (
                        <View style={s.listText}>
                          <Text style={s.rowTitle} numberOfLines={2} allowFontScaling={false}>
                            {it.title || '（无标题）'}
                          </Text>
                          <Text style={s.rowSub} numberOfLines={1} allowFontScaling={false}>
                            {it.source ? '来源 ' + it.source : '来源未知'}
                          </Text>
                        </View>
                      ) : (
                        <View style={{ flex: 1, height: 16 }} />
                      )}
                    </Pressable>
                    {/* B2：原地展开的一栏，两个入口 */}
                    {open ? (
                      <View style={s.hotActions}>
                        <Pressable
                          style={s.hotActBtn}
                          onPress={() => {
                            if (it.url) Linking.openURL(it.url).catch(() => {});
                          }}
                          accessibilityRole="button"
                        >
                          <Text style={s.hotActText} allowFontScaling={false}>查看原文</Text>
                        </Pressable>
                        <Pressable
                          style={s.hotActBtn}
                          onPress={() => {
                            const same = hotAi && hotAi.index === index && hotAi.text;
                            if (same) {
                              // 已经有解读：再点一次收起（通则 4）
                              setHotAi(null);
                              return;
                            }
                            askAi(index, it);
                          }}
                          accessibilityRole="button"
                        >
                          <Text style={s.hotActText} allowFontScaling={false}>AI 怎么看</Text>
                          {hotAi && hotAi.index === index && hotAi.loading ? (
                            <Text style={s.hotAiText} allowFontScaling={false}>正在想…</Text>
                          ) : null}
                        </Pressable>
                      </View>
                    ) : null}
                    {/* AI 的解读摊在这一行下面：有字显示三行，失败给原文 + 可重试 */}
                    {open && hotAi && hotAi.index === index ? (
                      <View style={s.hotAiBox}>
                        {hotAi.loading ? (
                          <View style={s.hotAiRow}>
                            <ActivityIndicator size="small" color={C.ink2} />
                            <Text style={s.hotAiBody} allowFontScaling={false}>正在读这条热点…</Text>
                          </View>
                        ) : hotAi.err ? (
                          <View style={s.hotAiRow}>
                            <Text style={s.hotAiErr} allowFontScaling={false}>{hotAi.err}</Text>
                            <Pressable onPress={() => askAi(index, it)} hitSlop={8} accessibilityRole="button">
                              <Text style={s.hotAiRetry} allowFontScaling={false}>重试</Text>
                            </Pressable>
                          </View>
                        ) : (
                          <Text style={s.hotAiBody} numberOfLines={4} allowFontScaling={false}>
                            {hotAi.text}
                          </Text>
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </HeroCard>

          <HeroCard
            title="选题池"
            meta={topicsMeta}
            onPress={!topics.loading && !topics.error && topicItems.length ? () => go('TopicsPool') : undefined}
            label="选题池"
          >
            {topics.loading && !tp ? (
              <StateLine st={topics} empty="正在取选题" />
            ) : topics.error && !tp ? (
              <ErrorBlock st={topics} />
            ) : topicShow === 0 ? (
              // 一条都没有时不许留 5 行「1 · —」占位 —— 那是拿行号假装有选题（通则 40）。
              // 老老实实说今天没出题，卡片高度由另外两张卡撑平。
              <Text style={s.stateText} allowFontScaling={false}>今天的选题还没生成</Text>
            ) : (
              // 2026-11-15（老板）：不凑 10 条，也不补空行 —— 有几条显示几条，
              // 行距放大到 6，卡片高度由三张卡共用的 minHeight 撑平。
              // 少几条就是少几行，宁可下方留白，也不塞占位让密度变高。
              [...Array(topicRowCount)].map((_, index) => {
                const topic = index < topicShow ? topicItems[index] : null;
                return (
                  <View key={topic ? (topic.id || 'topic-' + index) : 'topic-gap-' + index} style={s.listRow}>
                    {topic ? (
                      <>
                        <Text style={s.ordinal} allowFontScaling={false}>{index + 1} · </Text>
                        <Text style={s.listTitle} numberOfLines={1} allowFontScaling={false}>
                          {topic.title || '（无标题）'}
                        </Text>
                        <Text style={s.score} allowFontScaling={false}>{scoreFor(topic)}</Text>
                      </>
                    ) : null}
                  </View>
                );
              })
            )}
          </HeroCard>

          <HeroCard
            title="接着写"
            meta={draftMine && d && d.chars ? charsLabel(d.chars) : '我的观点'}
            onPress={openDraft}
            label="接着写，去我的观点"
          >
            {draft.loading && !d ? (
              <StateLine st={draft} empty="正在找上次的稿子" />
            ) : draft.error && !d ? (
              <ErrorBlock st={draft} />
            ) : draftMine && d ? (
              // 只有 1 条稿子也要把 220 撑满：标题区在上、「继续写 ›」贴底。
              // 底部那截留白由 draftFill 的 justifyContent:'space-between' 撑开，
              // 不靠塞透明假字（透明 ######## 一旦换行就会把真实行高也顶歪）。
              <View style={s.draftFill}>
                <View style={s.listText}>
                  <Text style={s.rowTitle} numberOfLines={2} allowFontScaling={false}>
                    {d.title || '（无标题）'}
                  </Text>
                  {d.tail ? (
                    <Text style={s.rowSub} numberOfLines={3} allowFontScaling={false}>
                      上次写到：{d.tail}
                    </Text>
                  ) : null}
                </View>
                <Text style={s.rowSub} allowFontScaling={false}>继续写 ›</Text>
              </View>
            ) : (
              <View style={s.draftFill}>
                <Text style={s.stateText} allowFontScaling={false}>还没有稿子，赶紧去写一篇。</Text>
                <Text style={s.emptyActionText} allowFontScaling={false}>点这里去我的观点 ›</Text>
              </View>
            )}
          </HeroCard>
        </ScrollView>

        <View style={s.sectionCard}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle} allowFontScaling={false}>今天动哪件</Text>
            <Pressable onPress={() => openBoard()} hitSlop={12} accessibilityRole="button" accessibilityLabel="打开看板">
              <Text style={s.sectionMeta} allowFontScaling={false}>看板 ›</Text>
            </Pressable>
          </View>
          {board.loading && !b ? (
            <StateLine st={board} empty="正在取看板" />
          ) : board.error && !b ? (
            <ErrorBlock st={board} />
          ) : b ? (
            <View style={s.boardGrid}>
              {BOARD_STATUS.map((item) => (
                <Pressable
                  key={item.key}
                  style={[s.boardCell, { width: boardCellW }]}
                  onPress={() => openBoard(item.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`看板 ${item.label}，${b[item.key] ?? 0} 件`}
                >
                  <Text style={s.boardCount} numberOfLines={1} allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.75}>{b[item.key] ?? 0}</Text>
                  {/* 5 栏后每格变窄，「阶段完成」四个字必须自动缩字号放进去，不许出现省略号 */}
                  <Text style={s.boardLabel} numberOfLines={1} allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.75}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={s.stateText} allowFontScaling={false}>今天没有待办</Text>
          )}
        </View>

        </Pressable>
      </ScrollView>
    </View>
  );
}

const makeStyles = (C, T, S, R) =>
  StyleSheet.create({
    head: { paddingHorizontal: S.page, paddingBottom: S.x4 },
    greeting: { color: C.ink, ...T.display },
    date: { color: C.ink2, ...T.meta, marginTop: S.x1 },
    heroRow: { paddingHorizontal: S.page, gap: S.x3, paddingBottom: S.x4, alignItems: 'flex-start' },
    heroCard: {
      // A1：上一版是 minHeight: 220，后来被改成 height: 220 —— 等于把卡锁死，
      // 反过来让今日热点去迁就另外两张。改回 minHeight：220 只当下限，三张共用这一处。
      minHeight: HERO_MIN_H,
      // A2：底色从 C.card（浅色下纯白）改成 C.softMint（浅青绿）。
      flexShrink: 0,
      backgroundColor: C.softMint,
      borderRadius: R.small,
      padding: S.x4,
      justifyContent: 'space-between',
    },
    heroHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: S.x2,
    },
    heroTitle: { color: C.ink, ...T.section },
    // A2：卡底变浅青绿后 ink3 压不住（约 2.9:1），统一提到 ink2（浅色 ≈5.4:1 / 深色 ≈6.5:1）
    heroMeta: { color: C.ink2, ...T.meta },
    // A1：内容区不再 flex:1 吃满卡片（那样量到的永远是卡片高度，量不出真实内容），
    // 改成 minHeight 由三张卡的最大内容高度定：内容多的高、内容少的补齐，总高必然一致。
    heroBody: { justifyContent: 'space-between', paddingTop: S.x1 },
    // flexGrow 而不是 flex:1：flex:1 的 flexBasis 是 0，父容器高度还是 auto 的第一帧会塌成 0 高；
    // flexGrow 保留内容高度，内容区一撑开又能贴到底部（「继续写 ›」仍钉在卡底）。
    draftFill: { flexGrow: 1, justifyContent: 'space-between', paddingTop: S.x1, paddingBottom: S.x2 },
    sectionCard: {
      marginHorizontal: S.page,
      marginBottom: S.x3,
      padding: S.x4,
      borderRadius: R.small,
      // 2026-11-15（老板第二次说太密）：间距不放 gap 上 ——
      // sectionCard 里除了 sectionHead 和 boardGrid，还有条件渲染的第三条（加载/错误/空态），
      // gap 一加就会连那条普通行距也隔 46，所以改成只挂在 sectionHead 的下外边距。
    },
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      // 「标题行底 → 胶囊顶」= 46（boardGrid.paddingTop 是 0，没有别的东西抵消它）
      marginBottom: 46,
    },
    // 今日观点那段是普通列表，不吃 46（否则标题和第一条之间空一大块）
    headTight: { marginBottom: S.x3 },
    sectionTitle: { color: C.ink, ...T.title },
    sectionMeta: { color: C.ink3, ...T.meta },
    row: { paddingVertical: S.x1, gap: S.x1 },
    rowTitle: { color: C.ink, ...T.body },
    rowSub: { color: C.ink2, ...T.meta },    // 2026-11-15（老板第三次说「选题池文字太密」）：每行留白从 4 加到 6，
    // 对齐从 flex-start 改成 center，行与行之间不再糊成一片。
    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.x2,
      paddingVertical: 6,
    },
    listText: { flex: 1, minWidth: 0, gap: S.x1 },
    listTitle: { flex: 1, minWidth: 0, color: C.ink, ...T.body },
    ordinal: {
      minWidth: S.x5,
      color: C.ink2,
      ...T.meta,
      textAlign: 'right',
    },
    score: { color: C.ink2, ...T.meta, marginLeft: S.x1 },
    ideaEmpty: { paddingVertical: S.x2 },
    // B2：热点条目原地展开的那一栏
    hotActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: S.x2,
      paddingLeft: S.x5,
      paddingBottom: S.x1,
    },
    hotActBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.x1,
      paddingHorizontal: S.x3,
      paddingVertical: S.x2,
      borderRadius: R.capsule,
      backgroundColor: C.card,
    },
    hotActText: { color: C.ink, ...T.meta, fontWeight: '500' },
    hotAiText: { color: C.ink3, ...T.meta },
    // AI 解读块：贴着上面那排气泡、跟正文左端对齐（通则 7 贴在被操作对象旁边）
    hotAiBox: { paddingLeft: S.x5, paddingRight: S.x2, paddingTop: S.x1, paddingBottom: S.x2 },
    hotAiRow: { flexDirection: 'row', alignItems: 'center', gap: S.x2, flexWrap: 'wrap' },
    hotAiBody: { color: C.ink2, ...T.meta, lineHeight: 18 },
    hotAiErr: { color: C.ink2, ...T.meta },
    hotAiRetry: { color: C.ink, ...T.meta, fontWeight: '600' },
    // 点空白收起的承接层：不透明、不挡内容，只接「真点在空白上」那一下
    hotBlank: { flexGrow: 1 },
    draftEmpty: { paddingVertical: S.x2, gap: S.x2, alignItems: 'flex-start' },
    emptyActionText: { color: C.ink, ...T.meta },
    boardGrid: { flexDirection: 'row', gap: S.x2, paddingTop: 0 },
    boardCell: {
      flexGrow: 0,
      flexShrink: 0,
      backgroundColor: C.card2,
      borderRadius: R.small,
      paddingVertical: S.x3,
      paddingHorizontal: S.x1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.x1,
    },
    boardCellOn: { backgroundColor: C.accent, borderColor: C.accent },
    boardCount: { color: C.ink, ...T.section, textAlign: 'center' },
    // 「待完成/进行中/阶段完成/已完成」这行字提到 ink2：ink3 在深色下几乎读不出（F3）
    boardLabel: { color: C.ink2, ...T.meta, textAlign: 'center' },
    stateRow: { flexDirection: 'row', alignItems: 'center', gap: S.x2, paddingVertical: S.x2 },
    stateText: { color: C.ink3, ...T.meta },
    centerBlock: { alignItems: 'center', paddingVertical: S.x3, gap: S.x2 },
    retryBtn: { paddingHorizontal: S.x4, paddingVertical: S.x2, borderRadius: R.capsule, backgroundColor: C.card2 },
    retryText: { color: C.ink2, ...T.meta },
  });
