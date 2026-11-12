import React, { createContext, useContext, useMemo } from 'react';

// 设计令牌（v4）。色值来自 design/APP设计令牌.md 的定案；字号/间距/圆角收紧到令牌规定的档位。
//
// 硬约束（改样式前先看）：
//   字号只五档：34 / 24 / 17 / 15 / 11，行高 41 / 30 / 22 / 21 / 15
//   间距只用 4 的倍数；页面左右边距固定 20
//   圆角只两档：大卡 32、小卡 24，其余一律胶囊
//   不要线：无 1px 边框、无分割线、无投影 —— line 一律 transparent

export const darkPalette = {
  bg: '#151518',
  card: '#26262F',
  card2: '#2E2E38',
  line: 'transparent',
  ink: '#FFFFFF',
  ink2: '#8B8B94',
  ink3: '#6E6E78',
  accent: '#F0EDF4',
  good: '#67D3A0',
  bad: '#FF7A70',
  onHero: '#FFFFFF',
  onAccent: '#151518',
  me: '#3A3F4A',
  hero: '#3A3F4A',
};

export const lightPalette = {
  bg: '#F5EFF7',
  card: '#FFFFFF',
  card2: '#EFE7F2',
  line: 'transparent',
  ink: '#302636',
  ink2: '#9A8C9E',
  ink3: '#B6A9BA',
  accent: '#CE9EDB',
  good: '#3A9B6E',
  bad: '#C4483B',
  onHero: '#FFFFFF',
  onAccent: '#302636',
  me: '#E8D9EE',
  hero: '#1A1A1A',
};

export const type = {
  display: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  section: { fontSize: 24, lineHeight: 30, fontWeight: '600' },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  meta: { fontSize: 11, lineHeight: 15, fontWeight: '400' },
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

const ThemeContext = createContext({
  scheme: 'dark',
  C: darkPalette,
  T: type,
  S: space,
  R: radius,
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
    };
  }, [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
