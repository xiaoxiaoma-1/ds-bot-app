import React, { createContext, useContext, useMemo } from 'react';

// 设计令牌（v4）。色值来自 design/APP设计令牌.md 的定案。
//
// 硬约束：
//   字号只五档 34 / 24 / 17 / 15 / 11
//   间距只用 4 的倍数，页面边距 20
//   圆角只两档：大卡 32、小卡 24，其余胶囊
//   不要线：无边框、无分割线、无投影

export const darkPalette = {
  bg: '#000000',
  card: '#121214',
  card2: '#1C1C1E',
  input: '#0E0E10',
  line: 'transparent',
  hairline: '#2A2A2E',
  ink: '#FFFFFF',
  ink2: '#9A9A9A',
  ink3: '#6E6E72',
  placeholder: '#8A8A8E',
  accent: '#7F9690',
  accentCoral: '#7F9690',
  brandHi: '#7F9690',
  good: '#67D3A0',
  bad: '#FF7A70',
  onHero: '#FFFFFF',
  onAccent: '#0A0A0A',
  me: '#1C1C1E',
  hero: '#121214',
  softMint: '#15201C',
  softBlue: '#141B22',
  softOat: '#211D17',
  scrim: 'rgba(0,0,0,0.62)',
  glass: 'rgba(20,20,22,0.88)',
  dockIdle: '#9A9A9A',
};

// 2026-11-14：投影归零，老板规矩「界面不许投影」
export const shadow = {
  card: { shadowColor: '#000000', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  float: { shadowColor: '#000000', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
};

export const lightPalette = {
  bg: '#F3F4F1',
  card: '#FFFFFF',
  card2: '#E9ECE7',
  input: '#FFFFFF',
  line: 'transparent',
  hairline: '#DDE2DC',
  ink: '#1B1D1B',
  ink2: '#646A66',
  ink3: '#8A908B',
  placeholder: '#7A817B',
  accent: '#5A766C',
  accentCoral: '#5A766C',
  brandHi: '#5A766C',
  good: '#3A9B6E',
  bad: '#C4483B',
  onHero: '#FFFFFF',
  onAccent: '#FFFFFF',
  me: '#E6EFE9',
  hero: '#1B1D1B',
  softMint: '#E6EFE9',
  softBlue: '#E6ECF3',
  softOat: '#EFEAE0',
  scrim: 'rgba(0,0,0,0.42)',
  glass: 'rgba(255,255,255,0.9)',
  dockIdle: '#9A9A9A',
};

export const type = {
  display: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.5 },
  section: { fontSize: 24, lineHeight: 30, fontWeight: '600', letterSpacing: -0.3 },
  title:   { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },
  body:    { fontSize: 15, lineHeight: 21, fontWeight: '400', letterSpacing: 0 },
  meta:    { fontSize: 11, lineHeight: 15, fontWeight: '400', letterSpacing: 0.2 },
};

export const space = {
  x1: 4,
  x2: 8,
  x3: 12,
  x4: 16,
  x5: 20,
  x6: 24,
  x8: 32,
  page: 20,
  card: 20,
  cardSm: 16,
  gap: 12,
  block: 24,
  section: 32,
};

export const radius = {
  big: 32,
  small: 24,
  capsule: 999,
};

// 头像语义色。来源：ds-bot 客户端 src/client/inks.js 的 INKS 表（打包在 client.js:1763-1784），
// 每项是 [浅色值, 深色值]，与电脑端逐个对上。
export const AVATAR_INKS = {
  deepseek: ['#4D6BFE', '#6A84FF'],
  charcoal: ['#141416', '#F1F2F4'],
  graphite: ['#2D2D2D', '#D6D6DA'],
  rose: ['#EC2F6B', '#FF5A7A'],
  sky: ['#0AA8D6', '#2EE6E0'],
  tangerine: ['#FF6900', '#FF8A2E'],
  cobalt: ['#082DFF', '#5C78FF'],
  black: ['#000000', '#FFFFFF'],
  brown: ['#9A6B44', '#7C5332'],
  red: ['#FF3E51', '#E02135'],
  orange: ['#FF6B1A', '#FF5E00'],
  yellow: ['#FFB020', '#F59E0B'],
  green: ['#10B981', '#059669'],
  cyan: ['#06B6D4', '#0891B2'],
  blue: ['#2563EB', '#3B82F6'],
  violet: ['#8B5CF6', '#7C3AED'],
  magenta: ['#F43F85', '#E11D74'],
  gray: ['#8A8F98', '#6E737B'],
  aurora: ['#00B8D4', '#2EE6E0'],
};

export function avatarInk(name, scheme) {
  const pair = AVATAR_INKS[name] || AVATAR_INKS.gray;
  return scheme === 'light' ? pair[0] : pair[1];
}

// 压在头像色上的字：按相对亮度选白字或深字（与 client.js 的 luminance 算法一致）
export function inkOn(bg) {
  if (typeof bg !== 'string' || !/^#[0-9a-f]{6}$/i.test(bg)) return '#FFFFFF';
  const ch = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
  return l > 0.42 ? '#1A1A1A' : '#FFFFFF';
}

const ThemeContext = createContext({
  scheme: 'dark',
  C: darkPalette,
  T: type,
  S: space,
  R: radius,
  H: shadow,
});

export function ThemeProvider({ scheme, children }) {
  const value = useMemo(() => {
    const light = scheme === 'light';
    return {
      scheme: light ? 'light' : 'dark',
      C: light ? lightPalette : darkPalette,
      T: type,
      S: space,
      R: radius,
      H: shadow,
    };
  }, [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
