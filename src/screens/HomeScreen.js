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
  loadTrainToday,
  loadTodayWords,
  loadTodayBlocks,
} from '../homeData';
import { buildGreetingAndDate } from '../greeting';
import { dockPadding } from './workbench/Dock';
import { setCached, useCachedResource } from '../cache';

const HERO_H = 470;
const HERO_W = 333;

export default function HomeScreen({ active = true, onOpenDraft, navigation }) {
  const { C, T, S, R } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();
  const { greeting, dateText } = useMemo(() => buildGreetingAndDate(), []);

  const manualRefresh = useRef(false);
  const board = useCachedResource('home:board', loadBoardSummary, { refreshOnMount: !manualRefresh.current });
  const hot = useCachedResource('home:hot', loadHotDaily, { refreshOnMount: !manualRefresh.current });
  const draft = useCachedResource('home:draft', loadDraftResume, { refreshOnMount: !manualRefresh.current });
  const ideas = useCachedResource('home:ideas', loadIdeas, { refreshOnMount: !manualRefresh.current });
  const topics = useCachedResource('home:topics', loadTopics, { refreshOnMount: !manualRefresh.current });
  const train = useCachedResource('home:train', loadTrainToday, { refreshOnMount: !manualRefresh.current });
  const words = useCachedResource('home:words', loadTodayWords, { refreshOnMount: !manualRefresh.current });
  const blocks = useCachedResource('home:blocks', loadTodayBlocks, { refreshOnMount: !manualRefresh.current });

  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    manualRefresh.current = true;
    try {
      const [b, h, d, i, t, tr, w, bl] = await Promise.all([
        loadBoardSummary(),
        loadHotDaily(),
        loadDraftResume(),
        loadIdeas(),
        loadTopics(),
        loadTrainToday(),
        loadTodayWords(),
        loadTodayBlocks(),
      ]);
      setCached('home:board', b);
      setCached('home:hot', h);
      setCached('home:draft', d);
      setCached('home:ideas', i);
      setCached('home:topics', t);
      setCached('home:train', tr);
      setCached('home:words', w);
      setCached('home:blocks', bl);
    } catch {
      // 保留旧数据，失败不打断当前页面
    }
    manualRefresh.current = false;
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadAll().finally(() => setRefreshing(false));
  }, [loadAll]);

  const b = board.data;
  const h = hot.data;
  const d = draft.data;
  const i = ideas.data;
  const tp = topics.data;
  const hotTitle = h ? (h.isToday ? '今日热点' : (h.date ? h.date + ' 热点' : '热点')) : '今日热点';
  const cardW = Math.min(HERO_W, Math.max(260, winWidth - S.page * 2));
  const snap = cardW + S.x3;

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

  const HeroCard = ({ tint, kicker, title, body, meta, footer, onPress }) => {
    const content = (
      <View style={[s.heroCard, { backgroundColor: tint }]}>
        <View>
          <Text style={s.heroKicker} allowFontScaling={false}>{kicker}</Text>
          <Text style={s.heroTitle} numberOfLines={3} allowFontScaling={false}>{title}</Text>
          {body ? (
            <Text style={s.heroBody} numberOfLines={4} allowFontScaling={false}>{body}</Text>
          ) : null}
        </View>
        <View style={s.heroBottom}>
          {meta ? (
            <Text style={s.heroMeta} numberOfLines={2} allowFontScaling={false}>{meta}</Text>
          ) : (
            <View />
          )}
          {footer ? (
            <Text style={s.heroFooter} allowFontScaling={false}>{footer}</Text>
          ) : null}
        </View>
      </View>
    );
    return onPress ? (
      <Pressable onPress={onPress} style={{ width: cardW, height: HERO_H }}>{content}</Pressable>
    ) : (
      <View style={{ width: cardW, height: HERO_H }}>{content}</View>
    );
  };

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
          snapToInterval={snap}
          snapToAlignment="start"
          contentContainerStyle={s.heroRow}
        >
          <HeroCard
            tint={C.softMint}
            kicker="今日热点"
            title={h && h.picked ? h.picked.title : '今天的热点还没生成'}
            body={h && h.picked && h.picked.source ? '来源 ' + h.picked.source : '打开选题池，看看今天可以写什么'}
            meta={h && h.itemCount ? `${h.itemCount} 条候选` : '每天更新'}
            footer="打开热点 ›"
            onPress={() => navigation && navigation.navigate && navigation.navigate('TopicsPool')}
          />
          <HeroCard
            tint={C.softBlue}
            kicker="选题池"
            title={tp && tp.items && tp.items[0] ? tp.items[0].title : '选题池还空着'}
            body={tp && tp.items && tp.items[1] ? tp.items[1].title : '把想到的题目先放进来，写的时候就有得挑'}
            meta={tp && tp.total ? `${tp.total} 条待挖` : '还没有选题'}
            footer="去挑一个 ›"
            onPress={() => navigation && navigation.navigate && navigation.navigate('TopicsPool')}
          />
          <HeroCard
            tint={C.softOat}
            kicker="接着写"
            title={d ? (d.title || '（无标题）') : '还没有稿子'}
            body={d && d.tail ? d.tail : '从上次停下的地方继续，不用重新找感觉'}
            meta={d && d.chars ? charsLabel(d.chars) : '稿库同步'}
            footer="继续写 ›"
            onPress={() => {
              if (d && onOpenDraft) onOpenDraft(d.id);
              else if (navigation && navigation.navigate) navigation.navigate('DraftLibrary');
            }}
          />
        </ScrollView>

        <View style={s.sectionCard}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle} allowFontScaling={false}>今天动哪件</Text>
            {b ? (
              <Text style={s.sectionMeta} allowFontScaling={false}>
                待办 {b.todo} · 在等你 {b.waiting.length}
              </Text>
            ) : null}
          </View>
          {!b ? (
            <StateLine st={board} empty="今天没有待办" />
          ) : b.waiting.length === 0 ? (
            <Text style={s.stateText} allowFontScaling={false}>今天没有在等你的</Text>
          ) : (
            b.waiting.map((it, index) => {
              if (!it || typeof it !== 'object') return null;
              return (
                <View key={String(it.id != null ? it.id : 'w' + index)} style={s.row}>
                  <Text style={s.rowTitle} numberOfLines={1} allowFontScaling={false}>
                    {it.title || '（无标题）'}
                  </Text>
                  {it.nextStep ? (
                    <Text style={s.rowSub} numberOfLines={1} allowFontScaling={false}>{it.nextStep}</Text>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        <View style={s.sectionCard}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle} allowFontScaling={false}>今日灵感</Text>
            {i && i.total ? (
              <Text style={s.sectionMeta} allowFontScaling={false}>{i.total} 条</Text>
            ) : null}
          </View>
          {ideas.loading ? (
            <StateLine st={ideas} empty="正在取灵感" />
          ) : ideas.error ? (
            <View style={s.centerBlock}>
              <Text style={s.stateText} allowFontScaling={false}>灵感没取到</Text>
              <Pressable onPress={loadAll} style={s.retryBtn}>
                <Text style={s.retryText} allowFontScaling={false}>重试</Text>
              </Pressable>
            </View>
          ) : i && i.items && i.items.length === 0 ? (
            <Text style={[s.stateText, { textAlign: 'center' }]} allowFontScaling={false}>
              还没有灵感，去工作台记一条。
            </Text>
          ) : i && i.items ? (
            i.items.slice(0, 3).map((idea) => (
              <View key={idea.id} style={s.row}>
                <Text style={s.rowTitle} numberOfLines={2} allowFontScaling={false}>
                  {idea.content || '（无内容）'}
                </Text>
              </View>
            ))
          ) : null}
        </View>

        <View style={s.sectionCard}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle} allowFontScaling={false}>快速开始</Text>
          </View>
          <View style={s.quickGrid}>
            <Pressable style={s.quickBtn} onPress={() => navigation && navigation.navigate && navigation.navigate('DraftLibrary')}>
              <Text style={s.quickText} allowFontScaling={false}>写新稿</Text>
            </Pressable>
            <Pressable style={s.quickBtn} onPress={() => navigation && navigation.navigate && navigation.navigate('Expression')}>
              <Text style={s.quickText} allowFontScaling={false}>练表达</Text>
            </Pressable>
            <Pressable style={s.quickBtn} onPress={() => navigation && navigation.navigate && navigation.navigate('Books')}>
              <Text style={s.quickText} allowFontScaling={false}>翻书</Text>
            </Pressable>
            <Pressable style={s.quickBtn} onPress={() => navigation && navigation.navigate && navigation.navigate('BotList')}>
              <Text style={s.quickText} allowFontScaling={false}>问顾问</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.sectionCard}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle} allowFontScaling={false}>今日进度</Text>
          </View>
          <View style={s.progressGrid}>
            <View style={s.progressCell}>
              <Text style={s.progressCount} allowFontScaling={false}>{train.data?.count ?? '—'}</Text>
              <Text style={s.progressLabel} allowFontScaling={false}>练了几次</Text>
            </View>
            <View style={s.progressCell}>
              <Text style={s.progressCount} allowFontScaling={false}>
                {(() => {
                  const n = words.data?.words;
                  if (n === undefined || n === null) return '—';
                  const num = Number(n);
                  if (num >= 10000) return (num / 10000).toFixed(1) + ' 万';
                  if (num >= 1000) return Math.round(num / 1000) + ' 千';
                  return num + ' 字';
                })()}
              </Text>
              <Text style={s.progressLabel} allowFontScaling={false}>今日采集</Text>
            </View>
            <View style={s.progressCell}>
              <Text style={s.progressCount} allowFontScaling={false}>
                {(() => {
                  const n = blocks.data?.blocks;
                  if (n === undefined || n === null) return '—';
                  return Math.round(Number(n)) + ' 块';
                })()}
              </Text>
              <Text style={s.progressLabel} allowFontScaling={false}>看了几块</Text>
            </View>
          </View>
        </View>

        <View style={s.sectionCard}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle} allowFontScaling={false}>选题池</Text>
            {tp && tp.total ? (
              <Text style={s.sectionMeta} allowFontScaling={false}>{tp.total} 条</Text>
            ) : null}
          </View>
          {!tp ? (
            <StateLine st={topics} empty="选题池空的" />
          ) : tp.items.length === 0 ? (
            <Text style={s.stateText} allowFontScaling={false}>没有待挖的选题</Text>
          ) : (
            tp.items.slice(0, 3).map((topic) => (
              <View key={topic.id} style={s.row}>
                <Text style={s.rowTitle} numberOfLines={2} allowFontScaling={false}>
                  {topic.title || '（无标题）'}
                </Text>
                {topic.board ? (
                  <Text style={s.rowSub} numberOfLines={1} allowFontScaling={false}>{topic.board}</Text>
                ) : null}
              </View>
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
    heroRow: { paddingHorizontal: S.page, gap: S.x3, paddingBottom: S.x4 },
    heroCard: {
      flex: 1,
      borderRadius: R.big,
      padding: S.x6,
      justifyContent: 'space-between',
    },
    heroKicker: { color: C.ink2, ...T.meta },
    heroTitle: { color: C.ink, ...T.section, marginTop: S.x2 },
    heroBody: { color: C.ink2, ...T.body, marginTop: S.x3 },
    heroBottom: { gap: S.x2 },
    heroMeta: { color: C.ink3, ...T.meta },
    heroFooter: { color: C.accent, ...T.meta },
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
    stateRow: { flexDirection: 'row', alignItems: 'center', gap: S.x2, paddingVertical: S.x2 },
    stateText: { color: C.ink3, ...T.meta },
    centerBlock: { alignItems: 'center', paddingVertical: S.x3, gap: S.x2 },
    retryBtn: { paddingHorizontal: S.x4, paddingVertical: S.x2, borderRadius: R.capsule, backgroundColor: C.card2 },
    retryText: { color: C.ink2, ...T.meta },
    quickGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: S.x3 },
    quickBtn: {
      width: '48%',
      height: 88,
      backgroundColor: C.card2,
      borderRadius: R.small,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quickText: { color: C.ink, ...T.title },
    progressGrid: { flexDirection: 'row', gap: S.x2, paddingTop: S.x2 },
    progressCell: {
      flex: 1,
      backgroundColor: C.card2,
      borderRadius: R.small,
      padding: S.x3,
      alignItems: 'center',
    },
    progressCount: { color: C.ink, ...T.section },
    progressLabel: { color: C.ink3, ...T.meta, marginTop: S.x1, textAlign: 'center' },
  });
