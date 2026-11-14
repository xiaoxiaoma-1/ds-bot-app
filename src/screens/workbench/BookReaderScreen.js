import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { darkPalette, lightPalette, useTheme } from '../../theme';
import { useRoles } from './roles';
import { cleanTitle, paginate, reflow, toSimplified } from './bookText';

// 书库阅读器（2026-11-14 改左右整页翻页）
//
// 总经理 2026-11-12 批的「纵向连续滚动」方向定错了，现在按番茄的左右翻页形态做：
//   一屏一页、横滑切页、整屏替换（不是仿真翻页、不是拖动跟手）。
//
// 顺序不能颠倒（E4）：
//   ① 先把每块正文 reflow（干掉 OCR 的硬换行）—— 量分页边界必须量重排后的正文
//   ② 前端分页：把已加载的 blocks 拼成连续正文 → 隐藏 Text 的 onTextLayout 拿 lines[]
//      → 按一页能放几行切页（不按字数硬切）
//   ③ 横向 ScrollView + pagingEnabled，每一页占满一屏，正文左右各留 S.page
//   ④ 进度按页算：读到 X% · 第 N/M 页；onProgress 传的块下标由页反推
//   ⑤ 翻到倒数第 3 页就 onNeedMore
//   ⑥ 点屏幕中间弹菜单：字号加减 / 护眼 / 深色浅色 / 浅绿底色
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
//   onNeedMore(nextOffset)
//   onProgress(chunkIdx)     翻页后防抖 500ms 才调用，由父层 POST
//   onBack

const TOP_H = 96;
const DEBOUNCE_MS = 500;
const NEAR_END_PAGES = 3;
const LETTER_SPACING = 0.3;
// 量尺窗口长度（字）：只量当前位置往后这么多，字号变化只重量这一段（G2）
const WIN_CHARS = 6000;

// 字号档：lineHeight 跟着字号走，不然大字号会挤成一坨
const FONT_STEPS = [
  { fontSize: 14, lineHeight: 24 },
  { fontSize: 15, lineHeight: 26 },
  { fontSize: 17, lineHeight: 29 },
  { fontSize: 19, lineHeight: 32 },
];

// G3：护眼就该是浅绿（softMint）。原来「护眼」挂在米黄（softOat）上、「浅绿」另起一档，
// 现在把名字对正：默认 / 护眼（浅绿）/ 米色。
const PAPERS = [
  { key: 'default', label: '默认' },
  { key: 'mint', label: '护眼' },
  { key: 'warm', label: '米色' },
];

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
  const { C, T, S, R, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);
  const { width: winWidth } = useWindowDimensions();

  const [pageH, setPageH] = useState(0);
  const [lines, setLines] = useState([]);
  const [pageIdx, setPageIdx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scaleIdx, setScaleIdx] = useState(1);
  const [paperKey, setPaperKey] = useState('default');
  // 「深色 / 浅色」是阅读器自己的开关，不动全局主题：只在这屏挑一套色板。
  const [night, setNight] = useState(scheme !== 'light');

  const scroller = useRef(null);
  const pageRef = useRef(0);
  const positioned = useRef(false);
  const progTimer = useRef(null);
  const lastBlock = useRef(-1);

  const P = night ? darkPalette : lightPalette;
  const paper = paperKey === 'warm' ? P.softOat : paperKey === 'mint' ? P.softMint : P.bg;
  const step = FONT_STEPS[Math.max(0, Math.min(FONT_STEPS.length - 1, scaleIdx))];
  const pageW = Math.max(0, winWidth - S.page * 2);

  // ① 重排 + 拼接：连续正文 + 每块在正文里的字符区间
  const doc = useMemo(() => {
    let text = '';
    const parts = [];
    blocks.forEach((b, i) => {
      const body = reflow(toSimplified(String((b && b.text) || '')));
      const head = b && b.heading ? reflow(toSimplified(String(b.heading))) : '';
      const chunk = (head ? head + '\n\n' : '') + body;
      if (!chunk) return;
      const start = text ? text.length + 2 : 0;
      if (text) text += '\n\n';
      parts.push({
        idx: b && b.idx != null ? b.idx : base + i,
        start,
        end: start + chunk.length,
      });
      text += chunk;
    });
    return { text, parts };
  }, [blocks, base]);

  // 量尺窗口：只量当前位置往后 WIN_CHARS 字（G2）
  const [winStart, setWinStart] = useState(0);
  // 跨窗口累计的页数（「第 N 页」用；换字号归零）
  const [pagesBefore, setPagesBefore] = useState(0);
  const winText = useMemo(
    () => doc.text.slice(winStart, winStart + WIN_CHARS),
    [doc.text, winStart],
  );

  // 正文窗口或宽度变了必须先清空（窗口一换，旧行的偏移就全废了）。
  // 字号变化**不清**：旧的页先留着，量尺重排完再整体替换，避免闪一下「正在排版…」。
  useEffect(() => {
    setLines([]);
  }, [winText, pageW]);

  // ② 量行：隐藏 Text 与正文同宽同字号，onTextLayout 直接给每行高度
  //
  // G2：原来量尺渲染的是**整本已加载正文**，字号一动就整本重量一遍 —— 这就是
  // 「点一下字号加大，它就在正在排版，排了半天」。现在只量当前位置附近一个窗口
  // （WIN_CHARS 字，约十几页），字号变化只重量这一个窗口；翻到窗口末尾再把窗口往后挪。
  const onTextLayout = useCallback(
    (e) => {
      const raw = (e && e.nativeEvent && e.nativeEvent.lines) || [];
      let cursor = 0;
      const out = raw.map((l) => {
        const t = String((l && l.text) || '');
        const found = t ? winText.indexOf(t, cursor) : -1;
        const start = (found >= 0 ? found : cursor) + winStart;
        cursor = (found >= 0 ? found : cursor) + t.length;
        return { text: t, height: Number(l && l.height) || step.lineHeight, start, end: cursor + winStart };
      });
      setLines(out);
    },
    [winText, winStart, step.lineHeight],
  );

  const pages = useMemo(() => paginate(lines, pageH), [lines, pageH]);

  const blockAt = useCallback(
    (offset) => {
      const parts = doc.parts;
      if (!parts.length) return 0;
      for (const p of parts) if (offset >= p.start && offset <= p.end) return p.idx;
      return parts[parts.length - 1].idx;
    },
    [doc.parts],
  );

  const writeProgress = useCallback(
    (chunkIdx) => {
      if (!total || !onProgress) return;
      if (progTimer.current) clearTimeout(progTimer.current);
      progTimer.current = setTimeout(() => onProgress(chunkIdx), DEBOUNCE_MS);
    },
    [total, onProgress],
  );

  useEffect(
    () => () => {
      if (progTimer.current) clearTimeout(progTimer.current);
    },
    [],
  );

  // ④ 页码变化 → 记进度（由页反推块下标）
  useEffect(() => {
    if (!pages.length) return;
    const page = pages[Math.max(0, Math.min(pages.length - 1, pageIdx))];
    if (!page) return;
    const bIdx = blockAt(page.start);
    if (bIdx === lastBlock.current) return;
    lastBlock.current = bIdx;
    writeProgress(bIdx);
  }, [pages, pageIdx, blockAt, writeProgress]);

  // ⑤ 翻到倒数第 3 页就补下一段
  useEffect(() => {
    if (!pages.length || !onNeedMore || loadingMore) return;
    if (base + blocks.length >= total) return;
    if (pages.length - 1 - pageIdx <= NEAR_END_PAGES) onNeedMore(base + blocks.length);
  }, [pages.length, pageIdx, onNeedMore, loadingMore, base, blocks.length, total]);

  // ⑥ 窗口翻完：把量尺窗口往后挪一屏的量，不重量前面的（G2）
  useEffect(() => {
    if (!pages.length || pages.length < 2) return;
    if (pageIdx < pages.length - 1) return;
    const lastEnd = pages[pages.length - 1].end;
    if (lastEnd >= doc.text.length) return;
    // 页码跨窗口累计：换窗口时把已经翻过的页数记下来，「第 N 页」才不会每窗口从头数
    setPagesBefore((n) => n + pages.length);
    setWinStart(lastEnd);
    setLines([]);
    pageRef.current = 0;
    setPageIdx(0);
    if (scroller.current) scroller.current.scrollTo({ x: 0, animated: false });
  }, [pageIdx, pages, doc.text.length]);

  // 换字号：只以当前页为锚重量（不是从第 0 页重量整本）
  const changeScale = useCallback(
    (next) => {
      const anchor = pages.length ? pages[Math.max(0, Math.min(pages.length - 1, pageIdx))].start : winStart;
      setScaleIdx(next);
      setWinStart(anchor);
      // 不清 lines：旧的一页先留着，量尺重新排完直接换成新的，
      // 用户看不到「正在排版…」那一下（这一窗口只有 6000 字，量得很快）。
      setPageIdx(0);
      setPagesBefore(0);
      pageRef.current = 0;
      if (scroller.current) scroller.current.scrollTo({ x: 0, animated: false });
    },
    [pages, pageIdx, winStart],
  );

  // 进书：页算好之后一次性跳到 savedIdx 所在页（不让用户自己翻回去）
  useEffect(() => {
    if (positioned.current || !pageW || !doc.parts.length) return;
    const savedPart = doc.parts.find((p) => p.idx === savedIdx);
    const offset = savedPart ? savedPart.start : 0;
    // 上次读到的位置在窗口外（比如读到第 300 块）→ 先把窗口挪过去，再定位
    if (offset < winStart || offset > winStart + WIN_CHARS - 200) {
      setWinStart(offset);
      setLines([]);
      return;
    }
    if (!pages.length) return;
    let target = pages.findIndex((p) => p.end > offset);
    if (target < 0) target = 0;
    positioned.current = true;
    setPageIdx(target);
    if (scroller.current) scroller.current.scrollTo({ x: target * winWidth, animated: false });
  }, [pages, pageW, savedIdx, doc.parts, winStart, winText, winWidth]);

  const onMomentumEnd = (e) => {
    const x = e && e.nativeEvent ? e.nativeEvent.contentOffset.x : 0;
    const i = Math.max(0, Math.round(x / Math.max(1, winWidth)));
    setPageIdx(i);
  };

  const pageCount = pages.length;
  // G2 文案：主进度只显示「第 N 页」（不显示总页数 —— 窗口只量了一段，总页数不可靠）。
  // N = 之前窗口已经翻过的页数 + 本窗口内的第几页。
  const pageNo = pagesBefore + Math.min(pageCount, pageIdx + 1);
  // 百分比按「当前块 / 总块数」算：后端 total 是块数，不用量字也能算准。
  const pct = useMemo(() => {
    if (!pages.length) return 0;
    const page = pages[Math.max(0, Math.min(pages.length - 1, pageIdx))];
    if (!page) return 0;
    const bIdx = blockAt(page.end);
    const all = Number(total) || 0;
    if (!all) return 0;
    // bIdx 是块下标（0 起），按「读到第几块」算比例
    return Math.min(100, Math.round(((Number(bIdx) + 1) / all) * 100));
  }, [pages, pageIdx, blockAt, total]);
  const canBigger = scaleIdx < FONT_STEPS.length - 1;
  const canSmaller = scaleIdx > 0;
  const title = cleanTitle(book && book.title ? book.title : '阅读');

  return (
    <View style={[s.root, { backgroundColor: paper }]}>
      {/* 顶部条：只放返回 + 书名 + 百分比 */}
      <View style={[s.bar, { paddingTop: insets.top, height: TOP_H + insets.top, backgroundColor: paper }]}>
        <Pressable style={s.barBtn} onPress={onBack} accessibilityRole="button" accessibilityLabel="返回书库">
          <Text style={[s.barBtnText, { color: P.ink }]} allowFontScaling={false}>
            ‹
          </Text>
        </Pressable>
        <Text style={[s.barTitle, { color: P.ink }]} numberOfLines={1} allowFontScaling={false}>
          {title}
        </Text>
        <Text style={[s.barPct, { color: P.ink2 }]} allowFontScaling={false}>
          {pct}%
        </Text>
      </View>

      {err ? (
        <Pressable onPress={onRetry} style={{ padding: S.page }} accessibilityRole="button">
          <Text style={{ color: C.bad, ...T.body }} allowFontScaling={false}>
            读不到正文：{err}
          </Text>
          <Text style={{ color: C.accent, marginTop: S.x2, ...T.body }} allowFontScaling={false}>
            点这里重试
          </Text>
        </Pressable>
      ) : (
        <>
          {/* 分页区：这里实测到的高度才是「一页能放多少行」的依据 */}
          <View
            style={s.pager}
            onLayout={(e) => {
              const h = (e && e.nativeEvent && e.nativeEvent.layout && e.nativeEvent.layout.height) || 0;
              if (h > 0 && Math.abs(h - pageH) > 1) setPageH(h);
            }}
          >
            {/* 隐藏量尺：和正文同宽同字号，只为了拿 lines[]。
                不响应点击、不参与滚动，opacity 0 但仍然参与布局。 */}
            {winText && pageW > 0 ? (
              <Text
                style={s.ruler}
                onTextLayout={onTextLayout}
                allowFontScaling={false}
                pointerEvents="none"
              >
                {winText}
              </Text>
            ) : null}

            {pages.length === 0 ? (
              <View style={s.center}>
                <Text style={[s.hint, { color: P.ink2 }]} allowFontScaling={false}>
                  {initialLoading ? '正在加载…' : err ? '读不到正文' : '正在排版…'}
                </Text>
              </View>
            ) : (
              <ScrollView
                ref={scroller}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                scrollEventThrottle={120}
                onMomentumScrollEnd={onMomentumEnd}
                style={s.pagerScroll}
              >
                {pages.map((pg, i) => (
                  <View key={'page-' + i} style={[s.page, { width: winWidth }]}>
                    <Pressable
                      style={s.pageHit}
                      onPress={() => setMenuOpen((v) => !v)}
                      accessibilityRole="button"
                      accessibilityLabel="阅读菜单"
                    >
                      <Text style={[s.body, { color: P.ink, fontSize: step.fontSize, lineHeight: step.lineHeight }]} allowFontScaling={false}>
                        {doc.text.slice(pg.start, pg.end)}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>

          {/* 菜单：点屏幕中间弹出来，点一下不会再自己收回去（只在再点一次或点「收起」才收） */}
          {menuOpen ? (
            <View style={[s.menu, { backgroundColor: C.card }]}>
              <View style={s.menuRow}>
                <Text style={s.menuLabel} allowFontScaling={false}>字号</Text>
                <Pressable
                  style={[s.chip, canSmaller ? null : s.chipOff]}
                  onPress={() => canSmaller && changeScale(scaleIdx - 1)}
                  disabled={!canSmaller}
                  accessibilityRole="button"
                  accessibilityLabel="字号减一档"
                >
                  <Text style={[s.chipText, canSmaller ? null : s.chipTextOff]} allowFontScaling={false}>
                    A－
                  </Text>
                </Pressable>
                <Pressable
                  style={[s.chip, canBigger ? null : s.chipOff]}
                  onPress={() => canBigger && changeScale(scaleIdx + 1)}
                  disabled={!canBigger}
                  accessibilityRole="button"
                  accessibilityLabel="字号加一档"
                >
                  <Text style={[s.chipText, canBigger ? null : s.chipTextOff]} allowFontScaling={false}>
                    A＋
                  </Text>
                </Pressable>
                <View style={s.flex} />
                <Pressable onPress={() => setMenuOpen(false)} hitSlop={12} accessibilityRole="button">
                  <Text style={s.closeText} allowFontScaling={false}>收起</Text>
                </Pressable>
              </View>

              <View style={s.menuRow}>
                <Text style={s.menuLabel} allowFontScaling={false}>底色</Text>
                {PAPERS.map((p) => (
                  <Pressable
                    key={p.key}
                    style={[
                      s.chip,
                      paperKey === p.key ? s.chipOn : null,
                      p.key === 'warm' ? { backgroundColor: C.softOat } : null,
                      p.key === 'mint' ? { backgroundColor: C.softMint } : null,
                    ]}
                    onPress={() => setPaperKey(p.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: paperKey === p.key }}
                  >
                    <Text
                      style={[s.chipText, paperKey === p.key ? s.chipTextOn : null]}
                      allowFontScaling={false}
                    >
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={s.menuRow}>
                <Text style={s.menuLabel} allowFontScaling={false}>模式</Text>
                <Pressable
                  style={[s.chip, night ? s.chipOn : null]}
                  onPress={() => setNight(true)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: night }}
                >
                  <Text style={[s.chipText, night ? s.chipTextOn : null]} allowFontScaling={false}>
                    深色
                  </Text>
                </Pressable>
                <Pressable
                  style={[s.chip, night ? null : s.chipOn]}
                  onPress={() => setNight(false)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: !night }}
                >
                  <Text style={[s.chipText, night ? null : s.chipTextOn]} allowFontScaling={false}>
                    浅色
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {loadingMore ? (
            <Text style={[s.more, { color: P.ink3 }]} allowFontScaling={false}>
              正在取下一段…
            </Text>
          ) : null}

          {/* 底部进度：与正文同底色、上下留白、上方一条 1px 分隔线 —— 正文不会再从底下透上来 */}
          <View style={[s.foot, { backgroundColor: paper, paddingBottom: insets.bottom + S.x2 }]}>
            <View style={s.footTrack}>
              <View style={[s.footFill, { width: pct + '%' }]} />
            </View>
            <Text style={[s.footText, { color: P.ink2 }]} allowFontScaling={false}>
              第 {pageNo} 页 · 读到 {pct}%
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

const makeStyles = (C, T, S, R, K) =>
  StyleSheet.create({
    root: { flex: 1 },

    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.x3,
      paddingHorizontal: S.page,
    },
    barBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    barBtnText: { ...T.title, marginTop: -2 },
    barTitle: { flex: 1, ...T.title },
    barPct: { ...T.meta },

    pager: { flex: 1 },
    pagerScroll: { flex: 1 },
    // 量尺：宽度/字号由正文决定，绝对定位藏在分页区左上角
    ruler: {
      position: 'absolute',
      left: S.page,
      top: 0,
      opacity: 0,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    hint: { ...T.body },

    page: { paddingHorizontal: S.page, paddingTop: S.x2 },
    pageHit: { flex: 1, minHeight: 1 },
    // 正文：lineHeight 26 保留（E2 的判据），字间距 0.3 让密排中文更透气
    body: { letterSpacing: LETTER_SPACING },

    menu: {
      marginHorizontal: S.page,
      marginBottom: S.x2,
      borderRadius: R.small,
      paddingHorizontal: S.x4,
      paddingVertical: S.x3,
      gap: S.x2,
    },
    menuRow: { flexDirection: 'row', alignItems: 'center', gap: S.x2 },
    menuLabel: { color: C.ink3, ...T.meta, width: 28 },
    flex: { flex: 1 },
    chip: {
      minWidth: 44,
      height: 32,
      paddingHorizontal: S.x3,
      borderRadius: R.capsule,
      backgroundColor: C.card2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipOn: { backgroundColor: K.brand },
    chipOff: { opacity: 0.45 },
    chipText: { color: C.ink, ...T.meta, fontWeight: '500' },
    chipTextOn: { color: K.onBrand },
    chipTextOff: { color: C.ink3 },
    closeText: { color: C.ink2, ...T.meta },

    more: { ...T.meta, textAlign: 'center', paddingVertical: S.x1 },

    foot: {
      paddingHorizontal: S.page,
      paddingTop: S.x2,
      borderTopWidth: 1,
      borderTopColor: C.hairline,
    },
    footTrack: { height: 4, borderRadius: 2, backgroundColor: C.card2, overflow: 'hidden' },
    footFill: { height: 4, backgroundColor: K.brand },
    footText: { marginTop: S.x1, ...T.meta },
  });
