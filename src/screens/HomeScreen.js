import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { charsLabel, loadBoardSummary, loadDraftResume, loadHotDaily } from '../homeData';
import { buildGreetingAndDate } from '../greeting';
import { dockPadding } from './workbench/Dock';
import { setCached, useCachedResource } from '../cache';

// 首页（我这边新建的屏）：三块各自独立加载、独立失败。
// 数据一律从 ../homeData 取，不在这里造假数兜底——接口挂了就显示空态。
// active=false 时不发请求（沿用 MainTabs 的门控）。
export default function HomeScreen({ active = true, onOpenDraft }) {
  const { C, T, S, R, scheme } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R, scheme), [C, T, S, R, scheme]);
  const insets = useSafeAreaInsets();

  const { greeting, dateText } = useMemo(() => buildGreetingAndDate(), []);

  const startedRef = useRefFlag();
  const manualRefresh = useRef(false); // 标记主动刷新，跳过缓存静默更新

  const board = useCachedResource('home:board', loadBoardSummary, { refreshOnMount: !manualRefresh.current });
  const hot = useCachedResource('home:hot', loadHotDaily, { refreshOnMount: !manualRefresh.current });
  const draft = useCachedResource('home:draft', loadDraftResume, { refreshOnMount: !manualRefresh.current });

  const loadAll = useCallback(async () => {
    manualRefresh.current = true; // 标记主动刷新，避免 hook 后台静默刷新
    try {
      const [b, h, d] = await Promise.all([loadBoardSummary(), loadHotDaily(), loadDraftResume()]);
      setCached('home:board', b);
      setCached('home:hot', h);
      setCached('home:draft', d);
    } catch {
      // 失败不更新缓存，保留旧数据，用户状态不变
    }
    manualRefresh.current = false;
  }, []);

  // 静默刷新由 useCachedResource 内部处理，切换 active 时不重复执行

  const StateLine = ({ st, empty }) => {
    if (st.loading) {
      return (
        <View style={s.stateRow}>
          <ActivityIndicator color={C.accent} />
          <Text style={s.stateText} allowFontScaling={false}>
            正在取
          </Text>
        </View>
      );
    }
    return (
      <Text style={[s.stateText, st.error ? { color: C.ink3 } : null]} allowFontScaling={false}>
        {st.error ? '数据没来：' + st.error : empty}
      </Text>
    );
  };

  const b = board.data;
  const h = hot.data;
  const d = draft.data;
  const hotTitle = h ? (h.isToday ? '今日热点' : (h.date ? h.date + ' 热点' : '热点')) : '今日热点';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingHorizontal: S.page, paddingTop: 0, paddingBottom: dockPadding(insets, S) }}
    >
      {/* ① 顶部：丁香形状 + 问候 + 日期 + 破边圆点/白圆（H01–H07） */}
      {/* 整块左右各出屏 20，所以下面的圆点坐标可以按屏幕坐标写，不用再减页面边距 */}
      <View style={s.heroBlock}>
        <View style={s.shape} />
        <View style={[s.greetWrap, { top: insets.top + S.x5 }]}>
          <Text style={s.greet} numberOfLines={1} allowFontScaling={false}>
            {greeting}
          </Text>
          <Text style={s.date} numberOfLines={1} allowFontScaling={false}>
            {dateText}
          </Text>
        </View>
        {/* 三个破边点：位置按圆心折算左上角（cx − d/2, cy − d/2） */}
        <View style={[s.dot, { left: 55, top: 181, width: 10, height: 10 }]} pointerEvents="none" />
        <View style={[s.dot, { left: 93, top: 190, width: 6, height: 6 }]} pointerEvents="none" />
        <View style={[s.dot, { left: 323, top: 173, width: 14, height: 14 }]} pointerEvents="none" />
        {/* 白圆：H07 写的是纯白两模式通用，压的是紫形状，所以写死 #FFFFFF 而不走令牌 */}
        <View style={s.whiteDot} pointerEvents="none" />
      </View>

      {/* ① 今天动哪件 */}
      <View style={s.card}>
        <View style={s.cardHead}>
          <Text style={s.cardTitle} allowFontScaling={false}>
            今天动哪件
          </Text>
          {b ? (
            <Text style={s.cardMeta} allowFontScaling={false}>
              待办 {b.todo} · 在等你 {b.waiting.length}
            </Text>
          ) : null}
        </View>
        {!b ? (
          <StateLine st={board} empty="今天没有待办" />
        ) : b.waiting.length === 0 ? (
          <Text style={s.stateText} allowFontScaling={false}>
            今天没有在等你的
          </Text>
        ) : (
          b.waiting.map((it, i) => {
            // 后端 waiting 目前给对象；这里挡一下非对象元素，免得一个 null 把整页打死。
            // 纯防御，没有实测到接口会给 null。
            if (!it || typeof it !== 'object') return null;
            return (
              <View key={String(it.id != null ? it.id : 'w' + i)} style={s.row}>
                <Text style={s.rowTitle} numberOfLines={1} allowFontScaling={false}>
                  {it.title || '（无标题）'}
                </Text>
                {it.nextStep ? (
                  <Text style={s.rowSub} numberOfLines={1} allowFontScaling={false}>
                    {it.nextStep}
                  </Text>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      {/* ② 今日热点 */}
      <View style={s.card}>
        <View style={s.cardHead}>
          <Text style={s.cardTitle} allowFontScaling={false}>
            {hotTitle}
          </Text>
          {h && h.itemCount ? (
            <Text style={s.cardMeta} allowFontScaling={false}>
              {h.itemCount} 条
            </Text>
          ) : null}
        </View>
        {!h ? (
          <StateLine st={hot} empty="今天的热点还没生成" />
        ) : !h.picked ? (
          <Text style={s.stateText} allowFontScaling={false}>
            这条日期没有挑出热点
          </Text>
        ) : (
          <View style={s.row}>
            <Text style={s.rowTitle} numberOfLines={2} allowFontScaling={false}>
              {h.picked.title}
            </Text>
            {h.picked.source ? (
              <Text style={s.rowSub} numberOfLines={1} allowFontScaling={false}>
                来源 {h.picked.source}
              </Text>
            ) : null}
          </View>
        )}
      </View>

      {/* ③ 接着写 */}
      <View style={s.card}>
        <View style={s.cardHead}>
          <Text style={s.cardTitle} allowFontScaling={false}>
            接着写
          </Text>
          {d && d.chars ? (
            <Text style={s.cardMeta} allowFontScaling={false}>
              {charsLabel(d.chars)}
            </Text>
          ) : null}
        </View>
        {!d ? (
          <StateLine st={draft} empty="还没有稿子" />
        ) : (
          <Pressable
            style={s.row}
            disabled={!onOpenDraft}
            onPress={() => onOpenDraft && onOpenDraft(d.id)}
          >
            <Text style={s.rowTitle} numberOfLines={1} allowFontScaling={false}>
              {d.title || '（无标题）'}
            </Text>
            {d.tail ? (
              <Text style={s.rowSub} numberOfLines={1} allowFontScaling={false}>
                {d.tail}
              </Text>
            ) : null}
            {d.source === 'latest' ? (
              <Text style={s.rowHint} allowFontScaling={false}>
                最近入库
              </Text>
            ) : null}
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

// 极简的「只跑一次」标记，避免再引 useRef 的额外 import
function useRefFlag() {
  const [box] = useState(() => ({ value: false }));
  return box;
}

// scheme 必须作为参数进来：它是组件内的局部变量，模块级函数取不到。
// 少传这一个参数，渲染到 dot 这行就是 ReferenceError，release 包直接闪退（2026-11-13 真机踩到）。
const makeStyles = (C, T, S, R, scheme) =>
  StyleSheet.create({
    // 顶部块：左右各出屏 20（所以块内坐标 = 屏幕坐标），高度 218 = 形状 196 + 白圆下沿 218
    heroBlock: { height: 218, marginHorizontal: -S.page, marginTop: 0, marginBottom: S.x4 },
    // H01：高 196、下沿左右各 64 弧、底色取品牌色（不是 C.hero —— 那是每日灵感主卡的颜色）
    shape: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      height: 196,
      // 深色下 C.accent 接近纯白，这块 196 高会变成刺眼大白块（老板：「上面那一块白色的太突兀了」）。
      // 换 C.card2：深 #2E2E38 / 浅 #EFE7F2。浅色下与页底 #F5EFF7 很接近，块感几乎消失——这是有意的。
      backgroundColor: C.card2,
      borderBottomLeftRadius: R.big * 2,
      borderBottomRightRadius: R.big * 2,
    },
    greetWrap: { position: 'absolute', left: S.page, right: S.page, gap: S.x1 },
    // 底色已从 C.accent（深色近白 #F0EDF4）换成 C.card2（深色 #2E2E38）。
    // 深色下必须同时换浅字，否则 #151518 压在 #2E2E38 上只有 1.36:1，问候语看不见。
    // 浅色仍用 onAccent（#302636 on #EFE7F2 = 11.94:1）。
    greet: { color: scheme === 'light' ? C.onAccent : C.ink, fontSize: 34, lineHeight: 41, fontWeight: '700' },
    date: { color: scheme === 'light' ? C.onAccent : C.ink, opacity: 0.78, fontSize: 11, lineHeight: 15, fontWeight: '500', marginTop: S.x1 },
    // 破边点：设计稿写 brandHi，但浅紫压浅紫看不清（EAD2EE on CE9EDB）。
    // 改成「与白圆同族但有主次」：浅色白 55% / 深色近黑 40%（形状深色是近白，白点会消失）。
    dot: {
      position: 'absolute',
      borderRadius: R.capsule,
      backgroundColor: scheme === 'light' ? 'rgba(255,255,255,0.55)' : 'rgba(21,21,24,0.4)',
    },
    whiteDot: { position: 'absolute', left: 280, top: 174, width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF' },
    card: { backgroundColor: C.card, borderRadius: R.small, padding: S.x4, marginBottom: S.x3, gap: S.x2 },
    cardHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    cardTitle: { color: C.ink, ...T.title },
    cardMeta: { color: C.ink3, ...T.meta },
    row: { paddingVertical: S.x1, gap: 2 },
    rowTitle: { color: C.ink, ...T.body },
    rowSub: { color: C.ink2, ...T.meta },
    rowHint: { color: C.ink3, ...T.meta },
    stateRow: { flexDirection: 'row', alignItems: 'center', gap: S.x2, paddingVertical: S.x2 },
    stateText: { color: C.ink3, ...T.meta },
  });
