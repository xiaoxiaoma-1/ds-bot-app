import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';

// 稿库页（骨架版 · 2026-11-12）
// 老板口径：**只要数据，不要操作按钮**（APP整改总方案.md 第 1 条）。
// 数据源对齐电脑端：dsh-media-workbench 的 wbquery.py summary()
//   posts / atoms / hiddenPosts / chars
//   bySource：[{ key, n, unit, chars, segments }] —— 推文 / 抖音文案 / 直播（按场 + 段数）/ 书
//   recent：{ 推文, 抖音文案, 直播, 书 } 近 7 天新增
//   topics：分类分布 [{ name, n }]；tagTop：高频标签 [{ name, n }]
// 本页不含列表、不含筛选、不含删除；唯一可点的是左上返回与底部 chrome。
//
// ★ 接真实数据时把 /api/dsh-media/summary 的 payload **整块**传进 summary，
//   前端不自己算任何聚合（总数、分类、标签全由后端给）。电脑端已经算好，前端只负责展示。
//
// props
//   summary   见 DEFAULT_SUMMARY 的结构（接真实数据时整块传进来）
//   onBack()  左上返回
//   activeTab / onTabPress   交给 Dock
//
// 颜色尺寸全部取 theme.js 与令牌档位：字号只用 34/24/17/15/11，间距 4 的倍数，
// 圆角只 R.big(32) / R.small(24) / R.capsule，零边框零投影。

const SHAPE_H = 196; // 顶部形状高，与工作台首页同一套头

// 假数：条数与电脑端量级一致，只用来验结构
const DEFAULT_SUMMARY = {
  posts: 1544,
  atoms: 12340,
  hiddenPosts: 512,
  chars: 8120000,
  sources: [
    { key: '推文', n: 986, unit: '篇', chars: 1860000, recent: 18 },
    { key: '抖音文案', n: 412, unit: '篇', chars: 460000, recent: 3 },
    { key: '直播', n: 58, unit: '场', chars: 1240000, segments: 312, recent: 1 },
    { key: '书', n: 88, unit: '本', chars: 960000, recent: 0 },
  ],
  topics: [
    { name: '商业', n: 234 },
    { name: '表达', n: 198 },
    { name: '心理', n: 176 },
    { name: '成长', n: 154 },
    { name: 'AI', n: 132 },
    { name: '历史', n: 96 },
    { name: '健康', n: 72 },
    { name: '未分类', n: 64 },
  ],
  tags: [
    { name: '干中学', n: 88 },
    { name: '第一性原理', n: 76 },
    { name: '反直觉', n: 64 },
    { name: '长期主义', n: 58 },
    { name: '注意力', n: 52 },
    { name: '复利', n: 46 },
    { name: '结构性', n: 41 },
    { name: '取舍', n: 38 },
    { name: '迁移', n: 33 },
    { name: '验证', n: 29 },
    { name: '成本', n: 26 },
    { name: '叙事', n: 23 },
    { name: '习惯', n: 19 },
    { name: '风险', n: 17 },
    { name: '同情', n: 12 },
    { name: '边界', n: 9 },
  ],
};

// 千分位：不依赖 Intl（Hermes 上不一定有）
function fmt(n) {
  const v = String(Math.round(Number(n) || 0));
  return v.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 字数统一折成「万」：812 万字 / 9,600 字
function wan(n) {
  const v = Number(n) || 0;
  if (v < 10000) return fmt(v) + ' ';
  return fmt(Math.round(v / 10000)) + ' 万';
}

export default function DraftLibraryScreen({ summary = DEFAULT_SUMMARY, onBack, activeTab = 'workbench', onTabPress }) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);

  const { posts, atoms, hiddenPosts, chars, sources, topics, tags } = summary;
  const recentTotal = sources.reduce((a, x) => a + (x.recent || 0), 0);

  // 四类来源两列：前两块用 brand 色块（体量最大的两类），后两块用 card，避免四块同色糊成一片
  const sourceRows = useMemo(() => {
    const out = [];
    for (let i = 0; i < sources.length; i += 2) out.push(sources.slice(i, i + 2));
    return out;
  }, [sources]);

  return (
    <View style={s.root}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: onTabPress ? dockPadding(insets, S) : S.page + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.top}>
          <View style={s.shape} />

          {/* 返回：44×44 圆，x=14（会话页 C02 同值），形状色上放 card 色圆 */}
          <Pressable
            style={[s.back, { top: insets.top }]}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="返回"
          >
            <Text style={s.backText} allowFontScaling={false}>
              ‹
            </Text>
          </Pressable>

          <View style={[s.headText, { top: insets.top + S.x6 * 2 + S.x1 }]}>
            <Text style={s.title} allowFontScaling={false}>
              稿库
            </Text>
            <Text style={s.subTitle} numberOfLines={1} allowFontScaling={false}>
              {fmt(posts)} 篇 · {wan(chars)}字 · 近 7 天 +{fmt(recentTotal)}
            </Text>
          </View>
        </View>

        {/* 总账：一屏唯一高对比卡 */}
        <View style={s.hero}>
          <Text style={s.heroTag} allowFontScaling={false}>
            稿库总量
          </Text>
          <View style={s.heroNumRow}>
            <Text style={s.heroNum} allowFontScaling={false}>
              {fmt(posts)}
            </Text>
            <Text style={s.heroUnit} allowFontScaling={false}>
              篇
            </Text>
          </View>
          <Text style={s.heroFoot} numberOfLines={1} allowFontScaling={false}>
            {wan(chars)}字 · 原子 {fmt(atoms)} 条 · 隐藏 {fmt(hiddenPosts)} 篇
          </Text>
        </View>

        {/* 四类来源：数字块形态（96 高 / 圆角 24 / 数字 34 + 标签 11），纯展示不可点 */}
        <Text style={s.section}>四类来源</Text>
        <View style={s.grid}>
          {sourceRows.map((row, i) => (
            <View key={i} style={s.gridRow}>
              {row.map((src, j) => {
                const isBrand = i * 2 + j === 0; // 只有体量最大的那一块用主色，权重靠颜色而不是靠大小
                return (
                  <View key={src.key} style={[s.block, isBrand ? s.blockBrand : s.blockPlain]}>
                    <View style={s.blockNumRow}>
                      <Text style={[s.blockNum, isBrand ? s.onBrandText : s.inkText]} allowFontScaling={false}>
                        {fmt(src.n)}
                      </Text>
                      <Text style={[s.blockUnit, isBrand ? s.onBrandText : s.inkText]} allowFontScaling={false}>
                        {src.unit || '篇'}
                      </Text>
                    </View>
                    <Text style={[s.blockFoot, isBrand ? s.onBrandText : s.ink2Text]} numberOfLines={1} allowFontScaling={false}>
                      {src.segments ? `${fmt(src.segments)} 段 · ` : ''}
                      {wan(src.chars)}字 · +{fmt(src.recent || 0)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        {/* 分类分布：只展示，不做筛选 */}
        <Text style={s.section}>分类分布</Text>
        <View style={s.chips}>
          {topics.map((t) => (
            <View key={t.name} style={s.chip}>
              <Text style={s.chipText} allowFontScaling={false}>
                {t.name} {fmt(t.n)}
              </Text>
            </View>
          ))}
        </View>

        {/* 高频标签：只展示 */}
        <Text style={s.section}>高频标签</Text>
        <View style={s.chips}>
          {tags.map((t) => (
            <View key={t.name} style={s.chip}>
              <Text style={s.chipText} allowFontScaling={false}>
                {t.name} {fmt(t.n)}
              </Text>
            </View>
          ))}
        </View>

        <Text style={s.legend} allowFontScaling={false}>
          +n 为该来源近 7 天新增 · 本页只读，不提供任何操作
        </Text>
      </ScrollView>

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
      borderBottomLeftRadius: R.big * 2, // 令牌未收录 64 弧，取大卡 32 的两倍
      borderBottomRightRadius: R.big * 2,
    },
    back: {
      position: 'absolute',
      left: 14, // 会话页 C02 同值
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

    hero: {
      marginTop: S.x4,
      marginHorizontal: S.page,
      height: 128,
      borderRadius: R.big,
      backgroundColor: C.hero,
      padding: S.card,
    },
    heroTag: { color: K.heroTag, opacity: K.heroTagOpacity, ...T.meta, fontWeight: '500' },
    heroNumRow: { marginTop: S.x1, flexDirection: 'row', alignItems: 'flex-end', gap: S.x1 },
    heroNum: { color: C.onHero, ...T.display },
    heroUnit: { color: C.onHero, ...T.meta, marginBottom: S.x2 },
    heroFoot: { marginTop: S.x1, color: K.onHeroSub, opacity: K.onHeroSubOpacity, ...T.meta },

    section: { marginTop: S.x6, marginHorizontal: S.page, color: C.ink, ...T.section },

    grid: { marginTop: S.x6, marginHorizontal: S.page },
    gridRow: { flexDirection: 'row', gap: S.gap, marginBottom: S.gap },
    block: {
      flex: 1,
      height: 96, // 令牌数字块高
      borderRadius: R.small,
      paddingHorizontal: S.x4,
      paddingTop: S.x4,
      paddingBottom: S.x3,
      justifyContent: 'space-between',
    },
    blockBrand: { backgroundColor: K.brand },
    blockPlain: { backgroundColor: C.card },
    blockNumRow: { flexDirection: 'row', alignItems: 'flex-end', gap: S.x1 },
    blockNum: { ...T.display },
    blockUnit: { ...T.meta, fontWeight: '500', marginBottom: S.x2 },
    blockFoot: { ...T.meta },
    onBrandText: { color: K.onBrand },
    inkText: { color: C.ink },
    ink2Text: { color: C.ink2 },

    chips: { marginTop: S.x4, marginHorizontal: S.page, flexDirection: 'row', flexWrap: 'wrap', gap: S.x2 },
    chip: {
      height: 32,
      borderRadius: R.capsule,
      paddingHorizontal: S.x3,
      backgroundColor: C.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipText: { color: C.ink2, ...T.meta },

    legend: { marginTop: S.x5, marginHorizontal: S.page, color: C.ink3, ...T.meta },
  });
