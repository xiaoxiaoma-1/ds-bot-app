import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useRoles } from './roles';

// 书库阅读器（2026-11-12）
// 总经理已批：**纵向连续滚动**（番茄默认形态，不是仿真翻页）。三条硬要求：
//   ① 不卡：一次拉 10 块、剩 3 块补；2.1 亿字绝不整本下发
//   ② 记住位置：滚动停止后 **防抖 500ms** 才写一次进度，不是每帧写
//   ③ 底部有进度：「读到 62% · 第 161/260 块」
// 进书直接用后端给的 savedIdx 跳回上次位置，不让用户自己翻回去。
//
// 压力样本：真实数据里单块最长 **8862 字**（平均 1007）。渲染按块铺开、不嵌套 ScrollView，长块只是更高，不会崩。
//
// 接口：GET  /api/dsh-media/book/read?id&offset&limit=10 → { title, author, pages, total, blocks[], savedIdx }
//       POST /api/dsh-media/book/progress { id, chunkIdx, total }
//
// props
//   book        { id, title, author? }
//   blocks      [{ idx, text, heading }]   已加载的块（全局下标 idx）
//   base        已加载块的起始全局下标
//   total       总块数
//   savedIdx    上次读到的块下标
//   loadingMore / err
//   onNeedMore(nextOffset)   剩 3 块时补 10 块
//   onProgress(chunkIdx)     防抖 500ms 后调用，由父层 POST
//   onBack

const TOP_H = 96; // 阅读态顶部条：不遮挡正文
const DEBOUNCE_MS = 500;
const NEAR_END = 3;

export default function BookReaderScreen({
  book,
  blocks = [],
  base = 0,
  total = 0,
  savedIdx = 0,
  loadingMore = false,
  initialLoading = false,
  err = null,
  onNeedMore,
  onProgress,
  onRetry,
  onBack,
}) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();

  
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);

  const [idx, setIdx] = useState(savedIdx); // 当前块（估算值，用于底部进度）
  const timer = useRef(null);
  const scrolled = useRef(false);

  // 卸载前把最后一次进度落库（防抖计时器还没到的那次）
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const writeProgress = useCallback(
    (i) => {
      if (!total || !onProgress) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => onProgress(i), DEBOUNCE_MS);
    },
    [total, onProgress],
  );

  const onScroll = (e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const y = contentOffset.y;
    const viewport = layoutMeasurement.height;
    const contentH = contentSize.height;

    // 进度估算：按可视区中心落在正文的百分比折算块下标（块高不等，只能折算）
    const ratio = contentH > viewport ? Math.min(1, Math.max(0, (y + viewport * 0.5) / contentH)) : 0;
    const approx = Math.min(total - 1, Math.max(0, Math.round(base + ratio * blocks.length)));
    if (approx !== idx) {
      setIdx(approx);
      scrolled.current = true;
      writeProgress(approx);
    }

    // 剩 3 块补 10 块
    const remainPx = contentH - (y + viewport);
    const nearEndBlocks = blocks.length - Math.floor((1 - ratio) * blocks.length);
    if (nearEndBlocks <= NEAR_END && remainPx < 1600 && blocks.length && base + blocks.length < total && onNeedMore && !loadingMore) {
      onNeedMore(base + blocks.length);
    }
  };

  const pct = total ? Math.min(100, Math.round(((idx + 1) / total) * 100)) : 0;

  return (
    <View style={s.root}>
      {/* 顶部条：只有返回 + 书名 + 一个小进度，不挡正文 */}
      <View style={[s.bar, { paddingTop: insets.top, height: TOP_H + insets.top }]}>
        <Pressable style={s.barBtn} onPress={onBack} accessibilityRole="button" accessibilityLabel="返回书库">
          <Text style={s.barBtnText} allowFontScaling={false}>
            ‹
          </Text>
        </Pressable>
        <Text style={s.barTitle} numberOfLines={1} allowFontScaling={false}>
          {book && book.title ? book.title : '阅读'}
        </Text>
        <Text style={s.barPct} allowFontScaling={false}>
          {pct}%
        </Text>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingHorizontal: S.page, paddingTop: S.x4, paddingBottom: insets.bottom + 96 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={120}
        onScroll={onScroll}
      >
        {err ? (
          <Pressable onPress={onRetry} accessibilityRole="button">
            <Text style={[s.body, { color: C.bad }]} allowFontScaling={false}>
              读不到正文：{err}
            </Text>
            <Text style={[s.body, { color: C.accent, marginTop: S.x2 }]} allowFontScaling={false}>
              点这里重试
            </Text>
          </Pressable>
        ) : initialLoading && blocks.length === 0 ? (
          <Text style={[s.body, { color: C.ink2 }]} allowFontScaling={false}>
            正在加载…
          </Text>
        ) : null}

        {blocks.map((b) => (
          <View key={b.idx} style={s.block}>
            {b.heading ? (
              <Text style={s.heading} allowFontScaling={false}>
                {b.heading}
              </Text>
            ) : null}
            <Text style={s.body} allowFontScaling={false}>
              {b.text}
            </Text>
          </View>
        ))}

        {loadingMore ? (
          <Text style={s.more} allowFontScaling={false}>
            正在取下一段…
          </Text>
        ) : null}
      </ScrollView>

      {/* 底部进度：贴着安全区，压在内容上（不占流） */}
      <View style={[s.foot, { bottom: insets.bottom + S.x3 }]} pointerEvents="none">
        <View style={s.footTrack}>
          <View style={[s.footFill, { width: pct + '%' }]} />
        </View>
        <Text style={s.footText} allowFontScaling={false}>
          读到 {pct}% · 第 {Math.min(total, idx + 1)}/{total || '?'} 块
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (C, T, S, R, K) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },

    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.x3,
      paddingHorizontal: S.page,
      backgroundColor: C.bg,
    },
    barBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    barBtnText: { color: C.ink, ...T.title, marginTop: -2 },
    barTitle: { flex: 1, color: C.ink, ...T.title },
    barPct: { color: C.ink2, ...T.meta },

    scroll: { flex: 1 },
    block: { marginBottom: S.x5 },
    heading: { marginBottom: S.x2, color: C.ink, ...T.title },
    body: { color: C.ink, ...T.body, lineHeight: 26 },
    more: { marginTop: S.x2, marginBottom: S.x6, color: C.ink3, ...T.meta, textAlign: 'center' },

    foot: { position: 'absolute', left: S.page, right: S.page },
    footTrack: { height: 4, borderRadius: 2, backgroundColor: C.card2, overflow: 'hidden' },
    footFill: { height: 4, backgroundColor: K.brand },
    footText: { marginTop: S.x1, color: C.ink2, ...T.meta },
  });
