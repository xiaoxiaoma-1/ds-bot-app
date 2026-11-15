import { useCallback, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import { type } from '../theme';

// 输入框统一高度规则（2026-11-15）。
//
// 病：打字打到框底再进一行，框往上长，外层 ScrollView 又跟着 scrollToEnd，
//     等于整页往下跳一次。打字这件事不该让页面动。
// 治：
//   ① 框有上限：minHeight（设计高度）~ maxHeight（5 行 + 内边距）；
//   ② 没到上限时用系统自带的「跟着字长」（不给 height，盒子按内容长），手感和现在完全一样；
//   ③ 一到上限就把 height 钉死在 maxHeight —— 再多出来的字由 multiline 自己在框内滚，
//      光标跟得上，框和页面一动都不动；
//   ④ 本组件绝不碰任何外层滚动容器。谁在 onContentSizeChange 里滚父级 ScrollView，谁就是那个 bug。
//
// 为什么还要 onContentSizeChange：只用来判断「有没有超上限」。
// 为什么 maxHeight 之外再钉一次 height：maxHeight 在各平台/各版本上的表现要赌，
//   钉住 height 是确定的；两者同时给不会互相打架（没超限时 height 不出现）。

export const INPUT_LINE = type.body.lineHeight; // 21（15/21 正文）
export const INPUT_MAX_LINES = 5;

// 5 行的高度 = 5 × 行高 + 上下内边距
export const inputMaxHeight = (lineHeight = INPUT_LINE, lines = INPUT_MAX_LINES, padVertical = 0) =>
  Math.round(lineHeight * lines + padVertical * 2);

export default function LiveInput({
  style,
  minHeight,
  maxHeight,
  minLines = 1,
  maxLines = INPUT_MAX_LINES,
  lineHeight = INPUT_LINE,
  padVertical = 0,
  onContentSizeChange,
  ...rest
}) {
  const [pinned, setPinned] = useState(false);
  const lastH = useRef(0);

  const floor = minHeight != null ? minHeight : Math.round(minLines * lineHeight + padVertical * 2);
  const cap = Math.max(floor, maxHeight != null ? maxHeight : inputMaxHeight(lineHeight, maxLines, padVertical));

  const measure = useCallback(
    (e) => {
      const raw = e && e.nativeEvent && e.nativeEvent.contentSize ? e.nativeEvent.contentSize.height : 0;
      if (raw > 0) {
        const next = Math.ceil(raw);
        // 0.5pt 以内视为没变，避免 iOS 亚像素抖动 -> setState -> 再排版 -> 再抖动
        if (Math.abs(lastH.current - next) >= 0.5) {
          lastH.current = next;
          const over = next > cap;
          setPinned((prev) => (prev === over ? prev : over));
        }
      }
      if (onContentSizeChange) onContentSizeChange(e);
    },
    [cap, onContentSizeChange],
  );

  return (
    <TextInput
      {...rest}
      multiline
      onContentSizeChange={measure}
      style={[style, { minHeight: floor, maxHeight: cap }, pinned ? { height: cap } : null]}
    />
  );
}
