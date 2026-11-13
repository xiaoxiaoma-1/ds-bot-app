import React, { createContext, useContext, useMemo } from 'react';

// 设计令牌（v4）。色值来自 design/APP设计令牌.md 的定案。
//
// 硬约束：
//   字号只五档 34 / 24 / 17 / 15 / 11
//   间距只用 4 的倍数，页面边距 20
//   圆角只两档：大卡 32、小卡 24，其余胶囊
//   不要线：无边框、无分割线、无投影

export const darkPalette = {
  bg: '#2B2B2B',
  card: '#363636',
  card2: '#3C3C3C',
  input: '#232323',
  line: 'transparent',
  hairline: '#4A4A4A',
  ink: '#FFFFFF',
  ink2: '#A0A0A0',
  ink3: '#959595',
  placeholder: '#959595',
  accent: '#F5F1E8',
  accentCoral: '#CE9EDB',
  brandHi: '#F5F1E8',
  good: '#67D3A0',
  bad: '#FF7A70',
  onHero: '#2B2B2B',
  onAccent: '#2B2B2B',
  me: '#3C3C3C',
  hero: '#3C3C3C',
};

export const shadow = {
  card: { shadowColor: '#000000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 7, elevation: 3 },
  float: { shadowColor: '#000000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.55, shadowRadius: 16, elevation: 6 },
};

export const lightPalette = {
  bg: '#F5EFF7',
  card: '#FFFFFF',
  card2: '#EFE7F2',
  line: 'transparent',
  ink: '#302636',
  ink2: '#78697D', // 原 #9A8C9E (3.17) → 5.10:1（白卡）/ 4.51:1（页底）
  ink3: '#B6A9BA',
  placeholder: '#817186', // 占位符专用色：比正文弱半档，但对输入框底色仍 ≥4.5:1（WCAG 正文标准）
  accent: '#CE9EDB',
  accentCoral: '#FFAB96',
  brandHi: '#EAD2EE',
  good: '#3A9B6E',
  bad: '#C4483B',
  onHero: '#FFFFFF',
  onAccent: '#302636',
  me: '#E8D9EE',
  hero: '#1A1A1A',
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
