import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { charsLabel, loadBoardSummary, loadDraftResume, loadHotDaily } from '../homeData';
import { buildGreetingAndDate } from '../greeting';
import { dockPadding } from './workbench/Dock';

// 首页（我这边新建的屏）：三块各自独立加载、独立失败。
// 数据一律从 ../homeData 取，不在这里造假数兜底——接口挂了就显示空态。
// active=false 时不发请求（沿用 MainTabs 的门控）。
export default function HomeScreen({ active = true, onOpenDraft }) {
  const { C, T, S, R, scheme } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R, scheme), [C, T, S, R, scheme]);
  const insets = useSafeAreaInsets();

  const { greeting, dateText } = useMemo(() => buildGreetingAndDate(), []);

  const [board, setBoard] = useState({ loading: true, error: null, data: null });
  const [hot, setHot] = useState({ loading: true, error: null, data: null });
  const [draft, setDraft] = useState({ loading: true, error: null, data: null });
  const startedRef = useRefFlag();

  const loadAll = useCallback(async () => {
    setBoard((p) => ({ ...p, loading: true, error: null }));
    setHot((p) => ({ ...p, loading: true, error: null }));
    setDraft((p) => ({ ...p, loading: true, error: null }));

    // 三块并行、各自落地：allSettled 保证一块失败不影响另外两块
    const [b, h, d] = await Promise.allSettled([loadBoardSummary(), loadHotDaily(), loadDraftResume()]);
    setBoard((p) => ({ ...p, loading: false, data: b.status === 'fulfilled' ? b.value : null, error: b.status === 'rejected' ? String(b.reason && b.reason.message ? b.reason.message : b.reason) : null }));
    setHot((p) => ({ ...p, loading: false, data: h.status === 'fulfilled' ? h.value : null, error: h.status === 'rejected' ? String(h.reason && h.reason.message ? h.reason.message : h.reason) : null }));
    setDraft((p) => ({ ...p, loading: false, data: d.status === 'fulfilled' ? d.value : null, error: d.status === 'rejected' ? String(d.reason && d.reason.message ? d.reason.message : d.reason) : null }));
  }, []);

  useEffect(() => {
    if (!active) return;
    if (startedRef.value) return; // 只在首次激活时拉；刷新走下拉/手动
    startedRef.value = true;
    loadAll();
  }, [active, loadAll, startedRef]);

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
      <Text style={{ color: '#FFFFFF', fontSize: 22, padding: 12 }}>渲染OK-1</Text>
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
      backgroundColor: C.accent,
      borderBottomLeftRadius: R.big * 2,
      borderBottomRightRadius: R.big * 2,
    },
    greetWrap: { position: 'absolute', left: S.page, right: S.page, gap: S.x1 },
    // 紫底/近白底都要能读，所以两种模式都用 C.onAccent，不用白字
    greet: { color: C.onAccent, fontSize: 34, lineHeight: 41, fontWeight: '700' },
    date: { color: C.onAccent, opacity: 0.78, fontSize: 11, lineHeight: 15, fontWeight: '500', marginTop: S.x1 },
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
