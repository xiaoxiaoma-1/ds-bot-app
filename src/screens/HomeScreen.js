import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  const [boardOpen, setBoardOpen] = useState(null);  // 'todo' | 'stage' | 'done' | 'doing' | null

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

  const hotItems = h && Array.isArray(h.items) && h.items.length
    ? h.items.slice(0, 5)  // 首页显示前5条
    : (h && h.picked ? [h.picked] : []);
  const topicItems = (tp && Array.isArray(tp.items)) ? tp.items.slice(0, 3) : [];
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

  const openBoard = (status) => setBoardOpen((v) => (v === status ? null : status));

  // 根据 boardOpen 状态过滤对应类别的卡片
  const categoryCards = useMemo(() => {
    if (!boardOpen || !b || !Array.isArray(b.cards)) return [];
    const list = b.cards.filter((c) => c.status === boardOpen);
    return list.slice(0, 30);
  }, [boardOpen, b]);

  const openIdeas = () => {
    const selected = ideaItems.map((x) => x && x.id).filter(Boolean);
    go('ViewsPool', selected.length ? { selected } : undefined);
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
            meta={h && h.itemCount ? `${h.itemCount} 条` : '每天更新'}
          >
            {hot.loading && !h ? (
              <StateLine st={hot} empty="正在取热点" />
            ) : hot.error && !h ? (
              <ErrorBlock st={hot} />
            ) : hotItems.length === 0 ? (
              <Text style={s.stateText} allowFontScaling={false}>今天的热点还没生成</Text>
            ) : (
              hotItems.map((it, index) => (
                <View key={'hot-' + index + '-' + ((it && (it.url || it.title)) || '')} style={s.listRow}>
                  <Text style={s.ordinal} allowFontScaling={false}>{index + 1}</Text>
                  <View style={s.listText}>
                    <Text style={s.rowTitle} numberOfLines={2} allowFontScaling={false}>
                      {(it && it.title) || '（无标题）'}
                    </Text>
                    <Text style={s.rowSub} numberOfLines={1} allowFontScaling={false}>
                      {(it && it.source) ? '来源 ' + it.source : '来源未知'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </HeroCard>

          <HeroCard
            title="选题池"
            meta={tp && tp.total ? `${tp.total} 条` : '去挑一个'}
            onPress={!topics.loading && !topics.error && topicItems.length ? () => go('TopicsPool') : undefined}
            label="选题池"
          >
            {topics.loading && !tp ? (
              <StateLine st={topics} empty="正在取选题" />
            ) : topics.error && !tp ? (
              <ErrorBlock st={topics} />
            ) : topicItems.length === 0 ? (
              <Text style={s.stateText} allowFontScaling={false}>选题池还空着</Text>
            ) : (
              topicItems.map((topic, index) => (
                <View key={(topic && topic.id) || 'topic-' + index} style={s.listRow}>
                  <Text style={s.ordinal} allowFontScaling={false}>{index + 1} · </Text>
                  <Text style={s.listTitle} numberOfLines={1} allowFontScaling={false}>
                    {(topic && topic.title) || '（无标题）'}
                  </Text>
                  <Text style={s.score} allowFontScaling={false}>{scoreFor(topic)}</Text>
                </View>
              ))
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
              <View style={s.listRow}>
                <View style={s.listText}>
                  <Text style={s.rowTitle} numberOfLines={1} allowFontScaling={false}>
                    {d.title || '（无标题）'}
                  </Text>
                  {d.tail ? (
                    <Text style={s.rowSub} numberOfLines={1} allowFontScaling={false}>
                      上次写到：{d.tail}
                    </Text>
                  ) : null}
                  <Text style={s.rowSub} allowFontScaling={false}>继续写 ›</Text>
                </View>
              </View>
            ) : (
              <View style={s.draftEmpty}>
                <Text style={s.stateText} allowFontScaling={false}>还没有稿子，赶紧去写一篇。</Text>
                <Text style={s.emptyActionText} allowFontScaling={false}>点这里去我的观点 ›</Text>
              </View>
            )}
          </HeroCard>
        </ScrollView>

        <View style={s.sectionCard}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle} allowFontScaling={false}>今天动哪件</Text>
            <Text style={s.sectionMeta} allowFontScaling={false}>看板</Text>
          </View>
          {board.loading && !b ? (
            <StateLine st={board} empty="正在取看板" />
          ) : board.error && !b ? (
            <ErrorBlock st={board} />
          ) : b ? (
            <>
              <View style={s.boardGrid}>
                {BOARD_STATUS.map((item) => (
                  <Pressable
                    key={item.key}
                    style={[s.boardCell, boardOpen === item.key ? s.boardCellOn : null]}
                    onPress={() => openBoard(item.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: boardOpen === item.key }}
                  >
                    <Text style={s.boardCount} allowFontScaling={false}>{b[item.key] ?? 0}</Text>
                    <Text style={s.boardLabel} allowFontScaling={false}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
              {boardOpen && b && categoryCards.length === 0 ? (
                <Text style={s.stateText} allowFontScaling={false}>这一类现在没有卡片</Text>
              ) : null}
              {boardOpen && categoryCards.length > 0 ? categoryCards.map((c) => (
                <View key={c.id} style={s.listRow}>
                  <View style={s.listText}>
                    <Text style={s.rowTitle} numberOfLines={2} allowFontScaling={false}>{c.title || '（无标题）'}</Text>
                    {c.nextStep ? (
                      <Text style={s.rowSub} numberOfLines={1} allowFontScaling={false}>{c.nextStep}</Text>
                    ) : null}
                  </View>
                </View>
              )) : null}
            </>
          ) : (
            <Text style={s.stateText} allowFontScaling={false}>今天没有待办</Text>
          )}
        </View>

        <View style={s.sectionCard}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle} allowFontScaling={false}>今日灵感</Text>
            {i && i.total ? (
              <Text style={s.sectionMeta} allowFontScaling={false}>{i.total} 条观点</Text>
            ) : null}
          </View>
          {ideas.loading && !i ? (
            <StateLine st={ideas} empty="正在取灵感" />
          ) : ideas.error && !i ? (
            <ErrorBlock st={ideas} />
          ) : ideaItems.length === 0 ? (
            <Text style={s.stateText} allowFontScaling={false}>观点库还空着，先去记一条。</Text>
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
      minHeight: 220,
      flexShrink: 0,
      backgroundColor: C.card,
      borderRadius: R.small,
      padding: S.x4,
    },
    heroHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: S.x2,
    },
    heroTitle: { color: C.ink, ...T.section },
    heroMeta: { color: C.ink3, ...T.meta },
    heroBody: { gap: S.x2 },
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
    rowSub: { color: C.ink2, ...T.meta },
    listRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: S.x2,
      paddingVertical: S.x1,
    },
    listText: { flex: 1, minWidth: 0, gap: S.x1 },
    listTitle: { flex: 1, minWidth: 0, color: C.ink, ...T.body },
    ordinal: {
      minWidth: S.x5,
      color: C.ink3,
      ...T.meta,
      textAlign: 'right',
    },
    score: { color: C.ink2, ...T.meta, marginLeft: S.x1 },
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
    boardCount: { color: C.ink, ...T.section },
    boardLabel: { color: C.ink3, ...T.meta, textAlign: 'center' },
    stateRow: { flexDirection: 'row', alignItems: 'center', gap: S.x2, paddingVertical: S.x2 },
    stateText: { color: C.ink3, ...T.meta },
    centerBlock: { alignItems: 'center', paddingVertical: S.x3, gap: S.x2 },
    retryBtn: { paddingHorizontal: S.x4, paddingVertical: S.x2, borderRadius: R.capsule, backgroundColor: C.card2 },
    retryText: { color: C.ink2, ...T.meta },
  });
