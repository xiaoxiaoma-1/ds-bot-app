import React, { createContext, useContext } from 'react';

// 深浅两套调色板。
// 深色沿用原来 theme.js 里的值（一个都没改）；浅色是本轮为修「不跟随系统」新增的临时值，
// 仍走现有色系，等设计令牌定稿后统一替换（见 design/APP设计系统.md）。
export const darkPalette = {
  bg: '#0b0e12',
  card: '#141922',
  card2: '#1b2230',
  line: '#242c3a',
  ink: '#e6e9ee',
  ink2: '#8b93a1',
  ink3: '#5c6474',
  accent: '#4c8dff',
  good: '#3ecf8e',
  bad: '#ff5f56',
  me: '#24344f',
};

export const lightPalette = {
  bg: '#f2f2f7',
  card: '#ffffff',
  card2: '#e9e9ee',
  line: '#d1d1d6',
  ink: '#111114',
  ink2: '#5c5c66',
  ink3: '#8e8e93',
  accent: '#0a7aff',
  good: '#1aa06a',
  bad: '#d92c20',
  me: '#dbe7ff',
};

const ThemeContext = createContext({ scheme: 'dark', C: darkPalette });

// scheme 来自 App.js 的 useColorScheme()：系统外观一变就重渲染 Provider，
// 所有 useTheme() 的组件随之拿到新调色板 —— 这就是「立刻跟着变」的机制。
export function ThemeProvider({ scheme, children }) {
  const value = React.useMemo(
    () => ({
      scheme: scheme === 'light' ? 'light' : 'dark',
      C: scheme === 'light' ? lightPalette : darkPalette,
    }),
    [scheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
