import { useMemo } from 'react';
import { useTheme } from '../../theme';

// 工作台各页共用的「令牌角色 → theme.js 键」映射。
// 只在这里写一次，别每页抄一份——抄八份就会有一份漏改。
//
// ★ theme.js 一旦改键名（accent / me / hero / card…），**这个文件是唯一改点**。
//   八块工作台页面全部通过 useRoles() 取值，改这里一处即全线生效；别去各页面里找硬引用。
//
// 令牌 → theme.js 现状（2026-11-13 核对）：
//   brand    → 浅色 C.accent（丁香紫 #CE9EDB）/ 深色 C.card2（#3C3C3C）——注：21 行实际代码
//   hero     → C.hero  （浅 #1A1A1A / 深 #3C3C3C）
//   card     → C.card
//   brandHi  → C.brandHi（浅 #EAD2EE / 深 #F5F1E8）
//   coral    → C.accentCoral（浅 #FFAB96 / 深 #CE9EDB）——「+1 条」这类增量药丸用它
export function roleOf(C, scheme) {
  const light = scheme === 'light';
  return {
    // 浅色 accent 是深绿，深色 accent 是雾青；药丸统一走 accent，保证两种模式都有对比。
    brand: light ? C.accent : C.card2,
    onBrand: light ? C.onAccent : C.ink,
    brandHi: C.brandHi,
    coral: C.accentCoral,
    edge: light ? C.card : C.hero,
    pill: C.accent,
    onPill: C.onAccent,
    heroTag: light ? C.me : C.ink,
    heroTagOpacity: light ? 1 : 0.8,
    onHeroSub: light ? C.ink2 : C.ink,
    onHeroSubOpacity: light ? 1 : 0.75,
    halftone: light ? C.card : C.ink,
    dock: light ? C.hero : C.card,
    dockIdle: C.dockIdle,
    dockIdleOpacity: light ? 1 : 0.75,
    dockOn: C.onHero,
    circle: C.onHero,
  };
}

// 每页都用的那套 useMemo，省得每个文件重复三行
export function useRoles() {
  const { C, scheme } = useTheme();
  return useMemo(() => roleOf(C, scheme), [C, scheme]);
}
