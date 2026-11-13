import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';

// 工作台首页（骨架版 · 2026-11-12）
// 依据：design/设计稿-定案-首页与会话页.md 第一屏 3.2 元素表 H01–H21；令牌 v4。
// 本轮只做结构：数据全是 props 默认值（假数），不接接口、不加动效。
//
// props（路由由移动端工程师挂，组件本身不管导航）
//   greeting         string   H02 问候语，34/41/700
//   dateText         string   H03 日期，11/15/500
//   inspiration      shape { tag, body, pill }   H08 每日灵感主卡
//   stats            [3]      H14–H16 采集台三数 { key, value, label }；不可点
//   features         [7]      H18 六张网格卡 + H19 一张全宽卡 { key, title, sub }
//   activeTab        string   dock 选中项：home | workbench | advisor | me
//   onPressInspiration()            主卡整体点击
//   onPressPill()                   H11「+1 条」点击（独立 responder，不冒泡到主卡）
//   onOpenFeature(key)              七块功能入口点击
//   onTabPress(key)                 dock 四项点击
//
// 颜色一律从 theme.js 取，本文件零硬编码色值。角色→键的对应见 roles()：
//   令牌 brand  → C.accent（浅 丁香紫 #CE9EDB / 深 近白 #F0EDF4）
//   令牌 hero   → C.hero  （浅 #1A1A1A / 深 #3A3F4A，深色下比底亮）
//   令牌 card   → C.card
//   令牌 ink/ink2 → C.ink / C.ink2
//   令牌 brandHi → theme.js 无此键，浅色用 C.me(#E8D9EE，≈令牌 #EAD2EE)、深色用 C.ink2(#8B8B94)
//   令牌 accent（珊瑚橙 #FFAB96）→ theme.js 的 accent 键已被主色占用，珊瑚橙无键可取；
//     药丸改走 浅 C.me / 深 C.accent，属偏差，已在交付说明里报备。
//
// 令牌硬约束在本文件的落点：零边框零投影（line 一律不引）、字号只 34/24/17/15/11、
// 间距只 4 的倍数、圆角只 32(R.big)/24(R.small)/胶囊(R.capsule)。

const SHAPE_H = 196; // H01 顶部形状高（宽 = 屏宽 + 左右各出 20）

const DEFAULT_INSPIRATION = {
  tag: '每日灵感',
  body: '把「能力表达」当成产品来做，而不是当成日记写——先立三条可复用的说法，再拿真实案例校准。',
  pill: '+1 条',
};

const DEFAULT_STATS = [
  { key: 'onair', value: '3', label: '在播' },
  { key: 'pending', value: '12', label: '待转写' },
  { key: 'done', value: '148', label: '转完' },
];

const DEFAULT_FEATURES = [
  { key: 'drafts', title: '稿库', sub: '186 篇' },
  { key: 'topics', title: '选题池', sub: '34 条待写' },
  { key: 'opinions', title: '观点库', sub: '512 条' },
  { key: 'myOpinions', title: '我的观点', sub: '28 条' },
  { key: 'corpus', title: '语料库', sub: '9.4 万词' },
  { key: 'books', title: '书库', sub: '62 本' },
  { key: 'ability', title: '能力表达', sub: '本周 +3 条' },
];

export default function WorkbenchHomeScreen({
  greeting = '下午好，金屿',
  dateText = '11月12日 周四',
  inspiration = DEFAULT_INSPIRATION,
  stats = DEFAULT_STATS,
  features = DEFAULT_FEATURES,
  activeTab = 'workbench',
  onPressInspiration,
  onPressPill,
  onOpenFeature,
  onTabPress,
  embedded = false,
}) {
  const { C, T, S, R, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);

  // 前 6 张两列，第 7 张全宽（H18 / H19）
  const { pairs, wide } = useMemo(() => {
    const grid = features.slice(0, 6);
    const out = [];
    for (let i = 0; i < grid.length; i += 2) out.push(grid.slice(i, i + 2));
    return { pairs: out, wide: features[6] };
  }, [features]);

  return (
    <View style={s.root}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: onTabPress ? dockPadding(insets, S) : S.page + insets.bottom }}
        showsVerticalScrollIndicator={false}
        // 动效不在本轮：不挂 Animated，不加入场
      >
        {/* ── 顶部块：形状 + 问候 + 每日灵感 + 破边装饰（H01–H12） ── */}
        <View style={s.top}>
          <View style={s.shape} />

          <View style={[s.greetWrap, { top: insets.top + S.x5 }]}>
            <Text style={s.greet} numberOfLines={1} allowFontScaling={false}>
              {greeting}
            </Text>
            <Text style={s.date} numberOfLines={1} allowFontScaling={false}>
              {dateText}
            </Text>
          </View>

          {/* H08 每日灵感：一屏唯一的高对比卡 */}
          <Pressable
            style={s.hero}
            onPress={onPressInspiration}
            accessibilityRole="button"
            accessibilityLabel={`每日灵感：${inspiration.tag}`}
          >
            <View style={s.halftone} pointerEvents="none">
              {Array.from({ length: 6 }).map((_, r) => (
                <View key={r} style={s.halftoneRow}>
                  {Array.from({ length: 6 }).map((__, c) => (
                    <View key={c} style={s.halftoneDot} />
                  ))}
                </View>
              ))}
            </View>

            <Text style={s.heroTag} allowFontScaling={false}>
              {inspiration.tag}
            </Text>            {/* 正文限宽 277，避免压到右下药丸（H10） */}
            <Text style={s.heroBody} numberOfLines={2} allowFontScaling={false}>
              {inspiration.body}
            </Text>

            {/* H11 药丸落在主卡热区内：独立 Pressable 接管 responder，父卡不同时响应 */}
            <Pressable
              style={s.pill}
              hitSlop={{ top: 10, bottom: 10, left: 0, right: 0 }}
              onPress={(e) => {
                if (e && e.stopPropagation) e.stopPropagation();
                if (onPressPill) onPressPill();
              }}
              accessibilityRole="button"
              accessibilityLabel={inspiration.pill}
            >
              <Text style={s.pillText} allowFontScaling={false}>
                {inspiration.pill}
              </Text>
            </Pressable>
          </Pressable>

          {/* 破边装饰层：绘在主卡之后，白圆骑形状下沿并压住主卡顶 6pt（3.3 第 2 条） */}
          <View style={[s.bd, { left: 55, top: 181, width: 10, height: 10 }]} pointerEvents="none" />
          <View style={[s.bd, { left: 93, top: 190, width: 6, height: 6 }]} pointerEvents="none" />
          <View style={[s.bd, { left: 323, top: 173, width: 14, height: 14 }]} pointerEvents="none" />
          <View style={s.edgeCircle} pointerEvents="none" />
        </View>

        {/* ── 采集台：整块不可点，无按下态、无箭头（H13–H16） ── */}
        <Text style={s.section}>采集台</Text>
        <View style={s.statsRow}>
          <View style={[s.stat, s.statBrand, s.statA]}>
            <Text style={[s.statNum, s.statNumDark]} allowFontScaling={false}>
              {stats[0] ? stats[0].value : ''}
            </Text>
            <Text style={[s.statLabel, s.statNumDark]} numberOfLines={1} allowFontScaling={false}>
              {stats[0] ? stats[0].label : ''}
            </Text>
          </View>
          <View style={[s.stat, s.statBrand, s.statB]}>
            <Text style={[s.statNum, s.statNumDark]} allowFontScaling={false}>
              {stats[1] ? stats[1].value : ''}
            </Text>
            <Text style={[s.statLabel, s.statNumDark]} numberOfLines={1} allowFontScaling={false}>
              {stats[1] ? stats[1].label : ''}
            </Text>
          </View>
          <View style={[s.stat, s.statPlain, s.statC]}>
            <Text style={[s.statNum, { color: C.ink }]} allowFontScaling={false}>
              {stats[2] ? stats[2].value : ''}
            </Text>
            <Text style={[s.statLabel, { color: C.ink }]} numberOfLines={1} allowFontScaling={false}>
              {stats[2] ? stats[2].label : ''}
            </Text>
          </View>
        </View>

        {/* ── 全部功能：六张网格卡 + 一张全宽卡（H17–H19） ── */}
        <Text style={s.sectionAll}>全部功能</Text>
        <View style={s.grid}>
          {pairs.map((pair, i) => (
            <View key={i} style={s.gridRow}>
              {pair.map((f) => (
                <Pressable
                  key={f.key}
                  style={s.card}
                  onPress={() => onOpenFeature && onOpenFeature(f.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${f.title}，${f.sub}`}
                >
                  <View style={s.sticker} />
                  <View style={s.cardText}>
                    <Text style={s.cardTitle} numberOfLines={1} allowFontScaling={false}>
                      {f.title}
                    </Text>
                    {f.sub ? (
                      <Text style={s.cardSub} numberOfLines={1} allowFontScaling={false}>
                        {f.sub}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </View>
          ))}
        </View>

        {wide ? (
          <Pressable
            style={s.wide}
            onPress={() => onOpenFeature && onOpenFeature(wide.key)}
            accessibilityRole="button"
            accessibilityLabel={`${wide.title}，${wide.sub}`}
          >
            <View style={s.sticker} />
            <View style={s.cardText}>
              <Text style={s.wideTitle} numberOfLines={1} allowFontScaling={false}>
                {wide.title}
              </Text>
              <Text style={s.wideSub} numberOfLines={1} allowFontScaling={false}>
                {wide.sub}
              </Text>
            </View>
          </Pressable>
        ) : null}
      </ScrollView>

      {onTabPress && !embedded ? <Dock activeTab={activeTab} onTabPress={onTabPress} /> : null}
    </View>
  );
}

const makeStyles = (C, T, S, R, K) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    scroll: { flex: 1 },

    // 顶部块：内容从屏顶 y=0 起，形状盖住灵动岛
    top: { paddingBottom: 0 },
    shape: {
      height: SHAPE_H,
      marginHorizontal: -S.page, // H01：左右各出屏 20
      backgroundColor: K.brand,
      borderBottomLeftRadius: R.big * 2, // H01 下沿左右各 64 弧（= 令牌大卡 32 的两倍）
      borderBottomRightRadius: R.big * 2,
    },
    greetWrap: { position: 'absolute', left: S.page, right: S.page },
    greet: { color: K.onBrand, ...T.display },
    date: { marginTop: S.x1, color: K.onBrand, ...T.meta, fontWeight: '500', opacity: 0.78 },

    // H08 主卡：距形状 16，宽满内容（353 @393）
    hero: {
      marginTop: S.x4,
      marginHorizontal: S.page,
      height: 168,
      borderRadius: R.big,
      backgroundColor: C.hero,
      padding: S.card,
      overflow: 'hidden',
    },
    halftone: {
      position: 'absolute',
      right: S.x4,
      top: S.x4,
      width: 88,
      height: 88,
      justifyContent: 'space-between',
    },
    halftoneRow: { flexDirection: 'row', justifyContent: 'space-between' },
    halftoneDot: { width: 2, height: 2, borderRadius: R.capsule, backgroundColor: K.halftone, opacity: 0.16 },

    heroTag: { color: K.heroTag, opacity: K.heroTagOpacity, ...T.meta, fontWeight: '500' },
    heroBody: { marginTop: S.x1, maxWidth: 277, color: C.onHero, ...T.title, lineHeight: 22 },

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
    pillText: { color: K.onPill, ...T.meta, fontWeight: '500', lineHeight: 15 },

    // 破边装饰（H04–H07）：坐标相对内容顶 y=0
    bd: { position: 'absolute', borderRadius: R.capsule, backgroundColor: K.brandHi },
    edgeCircle: {
      position: 'absolute',
      left: 280,
      top: 174,
      width: 44,
      height: 44,
      borderRadius: R.capsule,
      backgroundColor: K.edge,
    },

    // 区块标题：采集台距主卡 20（H13），全部功能距数字块 24（H17 坐标 574 − 550）
    section: { marginTop: S.x5, marginHorizontal: S.page, color: C.ink, ...T.section },
    sectionAll: { marginTop: S.x6, marginHorizontal: S.page, color: C.ink, ...T.section },

    statsRow: { flexDirection: 'row', marginTop: S.x6, marginHorizontal: S.page },
    stat: { height: 96, borderRadius: R.small, paddingHorizontal: S.x4, paddingTop: S.x4, paddingBottom: S.x3, justifyContent: 'space-between' },
    statBrand: { backgroundColor: K.brand },
    statPlain: { backgroundColor: C.card },
    statA: { width: 115 },
    statB: { width: 133, marginLeft: S.x2 }, // ①↔② 缝 8（6.5：同色不调）
    statC: { flex: 1, marginLeft: S.x3 }, // ②↔③ 缝 12（6.5 补偿 +4）
    statNum: { ...T.display },
    statNumDark: { color: K.onBrand },
    statLabel: { ...T.meta, fontWeight: '500' },

    grid: { marginTop: S.x6, marginHorizontal: S.page },
    gridRow: { flexDirection: 'row', gap: S.gap, marginBottom: S.gap },
    card: {
      flex: 1,
      height: 96,
      borderRadius: R.small,
      backgroundColor: C.card,
      padding: S.cardSm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.x3,
    },
    sticker: { width: 40, height: 40, borderRadius: R.capsule, backgroundColor: K.brandHi, top: -2 }, // 6.1 补偿 −2
    cardText: { flex: 1 },
    cardTitle: { color: C.ink, ...T.title },
    cardSub: { marginTop: S.x1, color: C.ink2, ...T.meta },

    wide: {
      marginTop: 0,
      marginHorizontal: S.page,
      height: 96,
      borderRadius: R.big,
      backgroundColor: C.hero,
      padding: S.card,
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.x3,
    },
    wideTitle: { color: C.onHero, ...T.title },
    wideSub: { marginTop: S.x1, color: K.onHeroSub, opacity: K.onHeroSubOpacity, ...T.meta },

  });
