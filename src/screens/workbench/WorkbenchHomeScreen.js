import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { BookOpen, Database, FileStack, Lightbulb, MessageSquareQuote, Mic, PenLine } from 'lucide-react-native';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';
import { loadTodayWords, loadTrainToday, loadTodayBlocks } from '../../homeData';

const DEFAULT_INSPIRATION = {
  tag: '今天先做',
  body: '把今天最想写的一句话先写下来，再决定它值不值得展开。',
  pill: '＋ 记一条',
};

const DEFAULT_FEATURES = [
  { key: 'drafts', title: '稿库' },
  { key: 'topics', title: '选题池' },
  { key: 'opinions', title: '观点库' },
  { key: 'myOpinions', title: '我的观点' },
  { key: 'corpus', title: '语料库' },
  { key: 'books', title: '书库' },
  { key: 'ability', title: '能力表达' },
];

const LINE_ICONS = {
  drafts: FileStack,
  topics: Lightbulb,
  opinions: MessageSquareQuote,
  myOpinions: PenLine,
  corpus: Database,
  books: BookOpen,
  ability: Mic,
};

function numberText(value, suffix) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return '—';
  return `${Math.round(Number(value))}${suffix}`;
}

export default function WorkbenchHomeScreen({
  greeting = '下午好，金屿',
  dateText = '11月12日 周四',
  inspiration = DEFAULT_INSPIRATION,
  features = DEFAULT_FEATURES,
  activeTab = 'workbench',
  onPressInspiration,
  onPressPill,
  onOpenFeature,
  onTabPress,
  embedded = false,
}) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);

  const [done, setDone] = useState({ words: null, train: null, blocks: null });

  useEffect(() => {
    let alive = true;
    Promise.allSettled([loadTodayWords(), loadTrainToday(), loadTodayBlocks()]).then((results) => {
      if (!alive) return;
      const val = (r) => (r.status === 'fulfilled' ? r.value : null);
      const words = val(results[0]);
      const train = val(results[1]);
      const blocks = val(results[2]);
      setDone({
        words: words ? words.words : null,
        train: train ? train.count : null,
        blocks: blocks ? blocks.blocks : null,
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  const featureRows = useMemo(() => {
    const list = Array.isArray(features) && features.length > 0 ? features : DEFAULT_FEATURES;
    return [
      list.slice(0, 2),
      list.slice(2, 5),
      list.slice(5, 7),
    ].filter((row) => row.length > 0);
  }, [features]);

  const draftFeature = (Array.isArray(features) ? features : []).find((f) => f.key === 'drafts');
  const draftSub = draftFeature && draftFeature.sub && draftFeature.sub !== '—' ? draftFeature.sub : '';

  const renderFeature = (item) => {
    const Icon = LINE_ICONS[item.key] || FileStack;
    return (
      <Pressable
        key={item.key}
        style={s.block}
        onPress={() => onOpenFeature && onOpenFeature(item.key)}
        accessibilityRole="button"
        accessibilityLabel={item.sub ? `${item.title}，${item.sub}` : item.title}
      >
        <Icon size={24} strokeWidth={1.6} color={C.ink2} />
        <View style={s.blockText}>
          <Text style={s.blockTitle} numberOfLines={1} allowFontScaling={false}>{item.title}</Text>
          {item.sub ? (
            <Text style={s.blockSub} numberOfLines={1} allowFontScaling={false}>{item.sub}</Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={s.root}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={{
          paddingBottom: onTabPress && !embedded ? dockPadding(insets, S) : S.page + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.greetWrap, { paddingTop: insets.top + S.x4 }]}>
          <Text style={s.greet} numberOfLines={1} allowFontScaling={false}>{greeting}</Text>
          <Text style={s.date} numberOfLines={1} allowFontScaling={false}>{dateText}</Text>
        </View>

        <Pressable
          style={s.hero}
          onPress={onPressInspiration}
          accessibilityRole="button"
          accessibilityLabel={`每日灵感：${inspiration.tag}`}
        >
          <Text style={s.heroTag} allowFontScaling={false}>{inspiration.tag}</Text>
          <Text style={s.heroBody} numberOfLines={2} allowFontScaling={false}>{inspiration.body}</Text>
          <Pressable
            style={s.pill}
            onPress={(e) => {
              if (e && e.stopPropagation) e.stopPropagation();
              if (onPressPill) onPressPill();
            }}
            accessibilityRole="button"
            accessibilityLabel={inspiration.pill}
          >
            <Text style={s.pillText} allowFontScaling={false}>{inspiration.pill}</Text>
          </Pressable>
        </Pressable>

        <Text style={s.sectionTitle} allowFontScaling={false}>全部入口</Text>
        <View style={s.featureRows}>
          {featureRows.map((row, index) => (
            <View key={index} style={s.featureRow}>
              {row.map(renderFeature)}
            </View>
          ))}
        </View>

        <View style={s.doneCard}>
          <View style={s.doneHead}>
            <Text style={s.doneTitle} allowFontScaling={false}>今日完成</Text>
            <Text style={s.doneHint} allowFontScaling={false}>今天干了些什么</Text>
          </View>
          <View style={s.doneRow}>
            <View style={s.doneCell}>
              <Text style={s.doneNumber} allowFontScaling={false}>{numberText(done.words, ' 字')}</Text>
              <Text style={s.doneLabel} allowFontScaling={false}>写下的字</Text>
            </View>
            <View style={s.doneCell}>
              <Text style={s.doneNumber} allowFontScaling={false}>{numberText(done.train, ' 次')}</Text>
              <Text style={s.doneLabel} allowFontScaling={false}>练表达</Text>
            </View>
            <View style={s.doneCell}>
              <Text style={s.doneNumber} allowFontScaling={false}>{numberText(done.blocks, ' 块')}</Text>
              <Text style={s.doneLabel} allowFontScaling={false}>看过的书</Text>
            </View>
          </View>
        </View>

        <Pressable
          style={s.lastWork}
          onPress={() => onOpenFeature && onOpenFeature('drafts')}
          accessibilityRole="button"
          accessibilityLabel="接着上次工作"
        >
          <Text style={s.lastKicker} allowFontScaling={false}>接着上次工作</Text>
          <Text style={s.lastTitle} numberOfLines={1} allowFontScaling={false}>
            {draftSub ? `稿库里还有 ${draftSub}` : '回稿库，接着写'}
          </Text>
          <Text style={s.lastHint} allowFontScaling={false}>打开稿库 ›</Text>
        </Pressable>
      </ScrollView>

      {onTabPress && !embedded ? <Dock activeTab={activeTab} onTabPress={onTabPress} /> : null}
    </View>
  );
}

const makeStyles = (C, T, S, R, K) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    scroll: { flex: 1 },
    greetWrap: { paddingHorizontal: S.page, paddingBottom: S.x3 },
    greet: { color: C.ink, ...T.display },
    date: { marginTop: S.x1, color: C.ink2, ...T.meta },
    hero: {
      marginHorizontal: S.page,
      height: 124,
      borderRadius: R.big,
      backgroundColor: C.hero,
      padding: S.card,
      overflow: 'hidden',
      justifyContent: 'center',
    },
    heroTag: { color: K.heroTag, opacity: K.heroTagOpacity, ...T.meta, fontWeight: '500' },
    heroBody: { marginTop: S.x1, maxWidth: '80%', color: C.onHero, ...T.title },
    pill: {
      position: 'absolute',
      right: S.x4,
      bottom: S.x4,
      minWidth: 56,
      height: 24,
      borderRadius: R.capsule,
      backgroundColor: K.pill,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: S.x2,
    },
    pillText: { color: K.onPill, ...T.meta, fontWeight: '500' },
    sectionTitle: { marginTop: S.x6, marginHorizontal: S.page, color: C.ink, ...T.section },
    featureRows: { marginTop: S.x3, marginHorizontal: S.page, gap: S.x3 },
    featureRow: { flexDirection: 'row', gap: S.x3 },
    block: {
      flex: 1,
      height: 96,
      borderRadius: R.small,
      backgroundColor: C.card,
      padding: S.cardSm,
      justifyContent: 'space-between',
    },
    blockText: { minWidth: 0 },
    blockTitle: { color: C.ink, ...T.title },
    blockSub: { color: C.ink3, ...T.meta, marginTop: S.x1 },
    doneCard: {
      marginHorizontal: S.page,
      marginTop: S.x6,
      padding: S.x4,
      borderRadius: R.small,
      backgroundColor: C.card,
    },
    doneHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    doneTitle: { color: C.ink, ...T.section },
    doneHint: { color: C.ink3, ...T.meta, marginLeft: S.x2 },
    doneRow: { flexDirection: 'row', gap: S.x2, marginTop: S.x3 },
    doneCell: {
      flex: 1,
      padding: S.x2,
      alignItems: 'center',
    },
    doneNumber: { color: C.ink, ...T.section },
    doneLabel: { color: C.ink3, ...T.meta, marginTop: S.x1, textAlign: 'center' },
    lastWork: {
      marginHorizontal: S.page,
      marginTop: S.x4,
      padding: S.x4,
      borderRadius: R.small,
      backgroundColor: C.card,
    },
    lastKicker: { color: C.ink3, ...T.meta },
    lastTitle: { color: C.ink, ...T.title, marginTop: S.x1 },
    lastHint: { color: C.accent, ...T.meta, marginTop: S.x2 },
  });
