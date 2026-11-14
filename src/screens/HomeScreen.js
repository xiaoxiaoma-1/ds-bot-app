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
  loadIdeas,
  loadTopics,
} from '../homeData';
import { buildGreetingAndDate } from '../greeting';
import { dockPadding } from './workbench/Dock';
import { setCached, useCachedResource } from '../cache';

const BOARD_STATUS = [
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
  const heroSnap = heroCardW + S.x3;

  const manualRefresh = useRef(false);
  const board = useCachedResource('home:board', loadBoardSummary, { refreshOnMount: !manualRefresh.current });
  const hot = useCachedResource('home:hot:list', loadHotDaily, { refreshOnMount: !manualRefresh.current });
  const draft = useCachedResource('home:draft', loadDraftResume, { refreshOnMount: !manualRefresh.current });
  const ideas = useCachedResource('home:ideas:views', loadIdeas, { refreshOnMount: !manualRefresh.current });
  const topics = useCachedResource('home:topics', loadTopics, { refreshOnMount: !manualRefresh.current });

  const [refreshing, setRefreshing] = useState(false);
  // B2：热点条目原地展开（不是跳页），同时只开一条
  const [hotOpen, setHotOpen] = useState(-1);

  const loadAll = useCallback(async () => {
    manualRefresh.current = true;
    try {
      const [b, h, d, i, t] = await Promise.all([
        loadBoardSummary(),
        loadHotDaily(),
        loadDraftResume(),
        loadIdeas(),
        loadTopics(),
      ]);
      setCached('home:board', b);
      setCached('home:hot:list', h);
      setCached('home:draft', d);
      setCached('home:ideas:views', i);
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
  const i = ideas.data;
  const tp = topics.data;

  const hotItems = h && Array.isArray(h.head) && h.head.length
    ? h.head // 数据层已经给了 head（前 5 条）
    : (h && h.picked ? [h.picked] : []);
  const topicItems = (tp && Array.isArray(tp.items)) ? tp.items.slice(0, 5) : [];
  const ideaItems = (i && Array.isArray(i.items)) ? i.items : [];

  // 服务端 posts 记录不算「我的稿子」，显示空态；只有 my_drafts 才显示接着写。
  const draftOrigin = String((d && (d.origin || d.source || d.table)) || '');
  // origin 字段没上线前，source==='opened'/'latest' 当作不确定，先显示稿子
  const draftMine = Boolean(d && d.id && (
    draftOrigin.toLowerCase().includes('my_drafts') || 
    (draftOrigin === 'opened' || draftOrigin === 'latest')
  ));

  const openDraft = () => {
    go('MyViews');
  };

  const openBoard = (status) => go('Board', status ? { status } : undefined);

  const openIdeas = () => {
    const selected = ideaItems.map((x) => x && x.id).filter(Boolean);
    go('ViewsPool', selected.length ? { selected } : undefined);
  };

  // B2：热点条目点开 = 卡片里原地展开一栏，两项：「查看原文」「AI 怎么看」
  const openHotItem = (index, it) => {
    setHotOpen((prev) => (prev === index ? -1 : index));
    if (!it) return;
    // 展开时把原文也顺手标一下，方便「查看原文」直接用
    return it;
  };

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
      <View style={s.heroBody}>{children}</View>
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
                          onPress={() => setHotOpen(index)}
                          accessibilityRole="button"
                        >
                          <Text style={s.hotActText} allowFontScaling={false}>AI 怎么看</Text>
                          <Text style={s.hotAiText} allowFontScaling={false}>接口待接入</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </HeroCard>

          <HeroCard
            title="选题池"
            meta={tp && tp.total ? `${tp.total} 条 ›` : '去挑一个'}
            onPress={!topics.loading && !topics.error && topicItems.length ? () => go('TopicsPool') : undefined}
            label="选题池"
          >
            {topics.loading && !tp ? (
              <StateLine st={topics} empty="正在取选题" />
            ) : topics.error && !tp ? (
              <ErrorBlock st={topics} />
            ) : (
              // 固定 5 行：和热点卡同条数、同高（220）。不足 5 条时补占位行，
              // 占位只显示「—」，不缩字号——三张卡的字必须一样大。
              [...Array(5)].map((_, index) => {
                const topic = index < topicItems.length ? topicItems[index] : null;
                return (
                  <View key={topic ? (topic.id || 'topic-' + index) : 'topic-empty-' + index} style={s.listRow}>
                    <Text style={s.ordinal} allowFontScaling={false}>{index + 1} · </Text>
                    {topic ? (
                      <>
                        <Text style={s.listTitle} numberOfLines={1} allowFontScaling={false}>
                          {topic.title || '（无标题）'}
                        </Text>
                        <Text style={s.score} allowFontScaling={false}>{scoreFor(topic)}</Text>
                      </>
                    ) : (
                      <>
                        <View style={s.listText} />
                        <Text style={s.score} allowFontScaling={false}>—</Text>
                      </>
                    )}
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
                  style={s.boardCell}
                  onPress={() => openBoard(item.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`看板 ${item.label}，${b[item.key] ?? 0} 件`}
                >
                  <Text style={s.boardCount} allowFontScaling={false}>{b[item.key] ?? 0}</Text>
                  <Text style={s.boardLabel} allowFontScaling={false}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={s.stateText} allowFontScaling={false}>今天没有待办</Text>
          )}
        </View>

        <View style={s.sectionCard}>
          <View style={s.sectionHead}>
            {/* D1：「今日灵感」改名「今日观点」 */}
            <Text style={s.sectionTitle} allowFontScaling={false}>今日观点</Text>
            <Pressable onPress={openIdeas} hitSlop={12} accessibilityRole="button" accessibilityLabel="打开观点库">
              <Text style={s.sectionMeta} allowFontScaling={false}>
                {i && i.total ? `${i.total} 条观点 ›` : '观点库 ›'}
              </Text>
            </Pressable>
          </View>
          {ideas.loading && !i ? (
            <StateLine st={ideas} empty="正在取观点" />
          ) : ideas.error && !i ? (
            <ErrorBlock st={ideas} />
          ) : ideaItems.length === 0 ? (
            // D2：空态那块以前是一句死文本，点了没反应；现在整块可点，一样进观点库
            <Pressable onPress={openIdeas} accessibilityRole="button" style={s.ideaEmpty}>
              <Text style={s.stateText} allowFontScaling={false}>观点库还空着，去记一条 ›</Text>
            </Pressable>
          ) : (
            ideaItems.map((idea, index) => (
              <Pressable
                key={(idea && idea.id) || 'idea-' + index}
                style={s.listRow}
                onPress={openIdeas}
                accessibilityRole="button"
              >
                <Text style={s.ordinal} allowFontScaling={false}>{index + 1}</Text>
                <Text style={s.listTitle} numberOfLines={2} allowFontScaling={false}>
                  {(idea && (idea.title || idea.content)) || '（无标题）'}
                </Text>
              </Pressable>
            ))
          )}
        </View>
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
    heroBody: { flex: 1, justifyContent: 'space-between', paddingTop: S.x1 },
    draftFill: { flex: 1, justifyContent: 'space-between', paddingTop: S.x1, paddingBottom: S.x2 },
    sectionCard: {
      marginHorizontal: S.page,
      marginBottom: S.x3,
      padding: S.x4,
      borderRadius: R.small,
      gap: S.x2,
    },
    sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    sectionTitle: { color: C.ink, ...T.title },
    sectionMeta: { color: C.ink3, ...T.meta },
    row: { paddingVertical: S.x1, gap: S.x1 },
    rowTitle: { color: C.ink, ...T.body },
    rowSub: { color: C.ink2, ...T.meta },    listRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: S.x2,
      paddingVertical: S.x1,
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
    draftEmpty: { paddingVertical: S.x2, gap: S.x2, alignItems: 'flex-start' },
    emptyActionText: { color: C.ink, ...T.meta },
    boardGrid: { flexDirection: 'row', gap: S.x2, paddingTop: S.x2 },
    boardCell: {
      flex: 1,
      backgroundColor: C.card2,
      borderRadius: R.small,
      paddingVertical: S.x3,
      paddingHorizontal: S.x1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.x1,
    },
    boardCellOn: { backgroundColor: C.accent, borderColor: C.accent },
    boardCount: { color: C.ink, ...T.section },    boardLabel: { color: C.ink3, ...T.meta, textAlign: 'center' },
    stateRow: { flexDirection: 'row', alignItems: 'center', gap: S.x2, paddingVertical: S.x2 },
    stateText: { color: C.ink3, ...T.meta },
    centerBlock: { alignItems: 'center', paddingVertical: S.x3, gap: S.x2 },
    retryBtn: { paddingHorizontal: S.x4, paddingVertical: S.x2, borderRadius: R.capsule, backgroundColor: C.card2 },
    retryText: { color: C.ink2, ...T.meta },
  });
