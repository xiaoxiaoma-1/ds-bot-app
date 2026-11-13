import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { avatarInk } from '../theme';
import CHARACTER_SHAPES from './characterShapes';

// 角色图标（2026-11-13）。规格：E:\dsh-plugins\reviews\icon-spec-11.md
//
// 三点硬约束：
//   1. 颜色在组件内用 scheme / C 算。**不要传进模块级的 makeStyles** ——
//      MainTabs.js 当初就是模块级 makeStyles 拿不到 scheme 导致 `scheme is not defined` 闪退。
//   2. eyes 原样取 CHARACTER_SHAPES[shape].eyes，不换算、不套公式。
//      每个 shape 的 eyes 是原设计师按该轮廓逐个调过的，一套通用公式必然把眼睛放错位置。
//   3. 图层顺序不能颠倒：形状本体 → shade(#000 7%) → 眼睛。
//      眼睛在 shade 之后，否则会被压灰。
//
// 坐标系：viewBox 100×100，形状本身占 ~92 单位（自带约 8% 安全边）。
// eye 是 [cx, cy, w, h, tilt]，**cx/cy 是眼睛中心**（对齐 ds-bot 的 eyeMarkup：
// translate(cx cy) rotate(tilt) → rect(x=-w/2, y=-h/2)）。

const VIEW = 100;

const SHADE_OPACITY = 0.07;

// 卡图标眼睛定案色（规格 §5.1）
const EYE_FILL = '#0F1A3C';

// 小尺寸补偿（规格 §1、§5.4）：换算后眼宽 < 2px 才启用
const SMALL_EYE_W_BOOST = 1.35;
const SMALL_EYE_H_BOOST = 1.15;
const SMALL_EYE_TRIGGER_PX = 2;

// 盒子小于这个值就不画眼睛，退回单色符号（规格 §1：≤20px 不做眼睛）
const MIN_BOX_FOR_EYES = 24;

function resolveFill(ink, scheme, color) {
  // color 优先：tab 未选中要单色 C.ink3，那个不是 ink 名
  if (typeof color === 'string' && color) return color;
  if (typeof ink === 'string' && ink.charAt(0) === '#') return ink; // 允许直接传十六进制
  return avatarInk(ink, scheme);
}

export default function CharacterIcon({
  shape,
  ink = 'gray',
  size = 32,
  scheme = 'dark',
  color,
  eyeColor,
  style,
}) {
  const def = CHARACTER_SHAPES[shape] || CHARACTER_SHAPES.gumdrop;
  const fill = resolveFill(ink, scheme, color);
  const fillEyes = eyeColor || EYE_FILL;

  const eyes = useMemo(() => {
    if (size < MIN_BOX_FOR_EYES) return null;
    const unit = size / VIEW; // 1 个 viewBox 单位 = 多少 px
    return def.eyes.map(([cx, cy, w, h, tilt], i) => {
      let ew = w;
      let eh = h;
      if (w * unit < SMALL_EYE_TRIGGER_PX) {
        ew = w * SMALL_EYE_W_BOOST;
        eh = h * SMALL_EYE_H_BOOST;
      }
      return (
        <Rect
          key={`eye-${i}`}
          x={cx - ew / 2}
          y={cy - eh / 2}
          width={ew}
          height={eh}
          rx={ew / 2}
          fill={fillEyes}
          transform={`rotate(${tilt}, ${cx}, ${cy})`}
        />
      );
    });
  }, [def, size, fillEyes]);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`} style={style}>
      {/* 1) 形状本体 */}
      <Path d={def.body} fill={fill} fillRule="evenodd" />
      {/* 2) shade：只压在形状上 */}
      <Path d={def.shade} fill="#000000" fillOpacity={SHADE_OPACITY} />
      {/* 3) 两条竖线眼：必须在 shade 之后 */}
      {eyes}
    </Svg>
  );
}

// 卡与 tab 的分配表（规格 §2），导出给接入方复用，避免两处各写一遍
export const CARD_ICONS = {
  drafts: { shape: 'pebbles', ink: 'graphite' },
  topics: { shape: 'plus', ink: 'tangerine' },
  opinions: { shape: 'gem', ink: 'blue' },
  myOpinions: { shape: 'star', ink: 'rose' },
  corpus: { shape: 'wave', ink: 'cyan' },
  books: { shape: 'acorn', ink: 'brown' },
  ability: { shape: 'magnet', ink: 'magenta' },
};

export const TAB_ICONS = {
  home: { shape: 'beacon', ink: 'deepseek' },
  workbench: { shape: 'hex', ink: 'cobalt' },
  advisors: { shape: 'whale', ink: 'sky' },
  mine: { shape: 'gumdrop', ink: 'violet' },
};
