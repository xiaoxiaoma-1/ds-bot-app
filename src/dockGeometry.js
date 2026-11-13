// dock 选中标识（圆 ↔ 胶囊）的几何。纯函数、不 import RN，好让 Node 侧直接测。
//
// 屏宽 393、dock 左右各 20 → 内宽 353，四格各 88.25。
// 高度恒 44；圆：宽 44；胶囊：宽 88（撑满一格，两端仍是半圆，所以 borderRadius 恒 22）。

export const DOCK_INSET = 20; // dock 距离屏幕左右各 20
export const IND_H = 44; // 指示器高度固定
export const IND_DOT = 44; // 圆态宽度
export const IND_PILL = 88; // 胶囊态宽度
export const RADIUS = IND_H / 2; // 恒 22：圆和胶囊两端都是半圆

// 第 i 格的中心（相对 dock 内宽坐标系，原点在 dock 左边缘）
export function cellCenter(innerWidth, count, i) {
  const cell = innerWidth / count;
  return cell * i + cell / 2;
}

// 指示器 left：让中心落在 cx 上
export function leftForCenter(cx, width) {
  return cx - width / 2;
}

// 四格的 cx 数组，给测试用
export function centers(innerWidth, count) {
  return Array.from({ length: count }, (_, i) => cellCenter(innerWidth, count, i));
}
