import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { charsLabel, loadBoardSummary, loadDraftResume, loadHotDaily } from '../homeData';

// 首页（我这边新建的屏）：三块各自独立加载、独立失败。
// 数据一律从 ../homeData 取，不在这里造假数兜底——接口挂了就显示空态。
// active=false 时不发请求（沿用 MainTabs 的门控）。
export default function HomeScreen({ active = true, onOpenDraft }) {
  const { C, T, S, R } = useTheme();
  const s = useMemo(() => makeStyles(C, T, S, R), [C, T, S, R]);
  const insets = useSafeAreaInsets();

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
      contentContainerStyle={{ paddingHorizontal: S.page, paddingTop: insets.top + S.x3, paddingBottom: S.x6 }}
    >
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
          b.waiting.map((it) => (
            <View key={String(it.id)} style={s.row}>
              <Text style={s.rowTitle} numberOfLines={1} allowFontScaling={false}>
                {it.title || '（无标题）'}
              </Text>
              {it.nextStep ? (
                <Text style={s.rowSub} numberOfLines={1} allowFontScaling={false}>
                  {it.nextStep}
                </Text>
              ) : null}
            </View>
          ))
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

const makeStyles = (C, T, S, R) =>
  StyleSheet.create({
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
