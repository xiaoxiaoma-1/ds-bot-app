import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { BookOpen, Database, FileStack, Lightbulb, MessageSquareQuote, Mic, PenLine } from 'lucide-react-native';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';

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

// 「—」是数据没接上时的占位符，不是副标题；渲染出来就是气泡下面那根横杠。
function realSub(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text || text === '—' || text === '-' || text === '--') return '';
  return text;
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

  const featureRows = useMemo(() => {
    const list = Array.isArray(features) && features.length > 0 ? features : DEFAULT_FEATURES;
    return [
      list.slice(0, 2),
      list.slice(2, 5),
      list.slice(5, 7),
    ].filter((row) => row.length > 0);
  }, [features]);

  const renderFeature = (item) => {
    const Icon = LINE_ICONS[item.key] || FileStack;
    const sub = realSub(item.sub);
    return (
      <Pressable
        key={item.key}
        style={s.block}
        onPress={() => onOpenFeature && onOpenFeature(item.key)}
        accessibilityRole="button"
        accessibilityLabel={sub ? `${item.title}，${sub}` : item.title}
      >
        <Icon size={24} strokeWidth={1.6} color={C.ink2} />
        <View style={s.blockText}>
          <Text style={s.blockTitle} numberOfLines={1} allowFontScaling={false}>{item.title}</Text>
          {sub ? (
            <Text style={s.blockSub} numberOfLines={1} allowFontScaling={false}>{sub}</Text>
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
      height: 260,
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
  });
