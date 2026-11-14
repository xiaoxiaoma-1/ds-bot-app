import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { getBase, getSess } from '../../store';
import { useRoles } from './roles';
import Dock, { dockPadding } from './Dock';
import ReviewBlock from './ReviewBlock';

// 我的观点页（骨架版 · 2026-11-12）
// 一屏两组：观点库里的观点 / 我自己写的观点。两组都直接铺在页面上，不做 mode 切换。
// 数据源：GET /api/myviews（父级 App.js 已接），写一条走 POST /api/myview_add（后端已有，body {content,title}）。
// 移到语料库走 POST /api/corpus_add（后端已有，路由读 body 的 id，不是 view_id）。
//
// props
//   views   [{ id, kind, title, content, review, created_at }]；undefined 表示父级还在读
//   detail  { id, loading, error, view } | null
//   onOpen(id) / onClose() / onDelete(view) / onReview(id) / onRetry()
//   onBack / activeTab / onTabPress

const SHAPE_H = 196;

// my_views.kind 的真实取值只有四个（2026-11-12 后端确认）：
//   自写 / 原话 / clash / free
const KIND_LABEL = {
  '自写': '自写',
  '原话': '原话',
  clash: '表态',
  free: '有感',
};
const kindLabel = (k) => KIND_LABEL[String(k || '')] || '未分类';

// 页面内直连已有的后端路由；workbenchApi.js 没有这两个 wrapper，本轮也不允许改它。
async function postJson(path, body) {
  const base = await getBase();
  if (!base) throw new Error('还没填服务地址');
  const sess = await getSess();
  if (!sess) throw new Error('没有会话凭证，需要先登录');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(String(base).replace(/\/+$/, '') + path, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + sess, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('等太久了，重试一下');
    throw new Error('网络不通：' + (e.message || '请求失败'));
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
  if (!data) throw new Error('返回的内容看不懂');
  if (data.ok === false) throw new Error(data.error || '这个操作没成功');
  return data;
}

async function addMyView(content) {
  const d = await postJson('/api/myview_add', { content });
  return {
    id: d.id || 'local_' + Date.now(),
    kind: '自写',
    title: content.length > 24 ? content.slice(0, 24) + '…' : content,
    content,
    review: {},
    created_at: '刚刚',
  };
}

async function addToCorpus(id) {
  // 路由 mobile_server.py:3820-3821 读的是 body.id；函数 api_corpus_add 的参数名才叫 view_id。
  await postJson('/api/corpus_add', { id, on: true });
}

export default function MyViewsScreen({
  views,
  detail = null,
  activeTab = 'workbench',
  onBack,
  onTabPress,
  onOpen,
  onClose,
  onDelete,
  onReview,
  onRetry,
}) {
  const { C, T, S, R } = useTheme();
  const insets = useSafeAreaInsets();
  const K = useRoles();
  const s = useMemo(() => makeStyles(C, T, S, R, K), [C, T, S, R, K]);

  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postErr, setPostErr] = useState(null);
  const [optimistic, setOptimistic] = useState([]);
  const [corpusBusy, setCorpusBusy] = useState(null);
  const [corpusDone, setCorpusDone] = useState({});
  const [corpusErr, setCorpusErr] = useState(null);

  const loading = views === undefined;
  const baseList = Array.isArray(views) ? views : [];
  const all = [...optimistic, ...baseList].filter((v, i, arr) => v && arr.findIndex((x) => x && x.id === v.id) === i);
  const selfList = all.filter((v) => v.kind === '自写');
  const poolList = all.filter((v) => v.kind !== '自写');
  const openId = detail && detail.id;
  const countText = (n) => (loading && n === 0 ? '…' : String(n));

  const submit = async () => {
    const t = draft.trim();
    if (!t || posting) {
      if (!t) setPostErr('写点什么再记');
      return;
    }
    setPosting(true);
    setPostErr(null);
    try {
      const added = await addMyView(t);
      setOptimistic((prev) => [added, ...prev]);
      setDraft('');
      if (onRetry) Promise.resolve(onRetry()).catch(() => {});
    } catch (e) {
      setPostErr(String((e && e.message) || '没记上'));
    } finally {
      setPosting(false);
    }
  };

  const moveToCorpus = async (v) => {
    if (!v || corpusBusy || corpusDone[v.id]) return;
    setCorpusBusy(v.id);
    setCorpusErr(null);
    try {
      await addToCorpus(v.id);
      setCorpusDone((prev) => ({ ...prev, [v.id]: true }));
      if (onRetry) Promise.resolve(onRetry()).catch(() => {});
    } catch (e) {
      setCorpusErr(String((e && e.message) || '没移进去'));
    } finally {
      setCorpusBusy(null);
    }
  };

  const renderRow = (v) => {
    const open = openId === v.id;
    const score = v.review && v.review.score;
    return (
      <View key={v.id} style={s.cardWrap}>
        <Pressable
          style={s.row}
          onPress={() => (open ? onClose && onClose() : onOpen && onOpen(v.id))}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${v.title}，${score == null ? '未评' : score + ' 分'}`}
        >
          <View style={s.rowTop}>
            <View style={s.kindPill}>
              <Text style={s.kindText} allowFontScaling={false}>
                {kindLabel(v.kind)}
              </Text>
            </View>
            <Text style={s.rowTitle} numberOfLines={2} allowFontScaling={false}>
              {v.title || '（无标题）'}
            </Text>
            <Text
              style={[s.rowScore, { color: score == null ? C.ink3 : score >= 85 ? C.good : C.ink }]}
              allowFontScaling={false}
            >
              {score == null ? '未评' : score}
            </Text>
          </View>
        </Pressable>

        {open ? (
          <View style={s.detail}>
            {detail.loading ? (
              <Text style={s.muted} allowFontScaling={false}>
                读原文…
              </Text>
            ) : detail.error ? (
              <Text style={[s.muted, { color: C.bad }]} allowFontScaling={false}>
                {detail.error}
              </Text>
            ) : detail.view ? (
              <>
                <Text style={s.detailLabel} allowFontScaling={false}>
                  我的原文（一字未改）
                </Text>
                <View style={s.origin}>
                  <Text style={s.originText} allowFontScaling={false}>
                    {detail.view.content}
                  </Text>
                </View>
                <Text style={s.detailMeta} allowFontScaling={false}>
                  {detail.view.created_at || ''}
                </Text>

                <View style={s.reviewWrap}>
                  <ReviewBlock review={detail.view.review} onRetry={() => onReview && onReview(v.id)} />
                </View>

                <View style={s.acts}>
                  <Pressable style={s.actBtn} onPress={() => onReview && onReview(v.id)} accessibilityRole="button">
                    <Text style={s.actText} allowFontScaling={false}>
                      重新评
                    </Text>
                  </Pressable>
                  <Pressable
                    style={s.actBtn}
                    onPress={() => moveToCorpus(v)}
                    disabled={Boolean(corpusBusy) || Boolean(corpusDone[v.id])}
                    accessibilityRole="button"
                  >
                    <Text style={[s.actText, { color: corpusDone[v.id] ? C.ink3 : K.brand }]} allowFontScaling={false}>
                      {corpusBusy === v.id ? '正在移…' : corpusDone[v.id] ? '已在语料库' : '移到语料库'}
                    </Text>
                  </Pressable>
                  <Pressable style={s.actBtn} onPress={() => onDelete && onDelete(v)} accessibilityRole="button">
                    <Text style={[s.actText, { color: C.bad }]} allowFontScaling={false}>
                      删
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: onTabPress ? dockPadding(insets, S) : S.page + insets.bottom }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.top}>
          <View style={s.shape} />
          <Pressable style={[s.back, { top: insets.top }]} onPress={onBack} accessibilityRole="button" accessibilityLabel="返回">
            <Text style={s.backText} allowFontScaling={false}>
              ‹
            </Text>
          </Pressable>
          <View style={[s.headText, { top: insets.top + S.x6 * 2 + S.x1 }]}>
            <Text style={s.title} allowFontScaling={false}>
              我的观点
            </Text>
            <Text style={s.subTitle} numberOfLines={1} allowFontScaling={false}>
              {loading ? '正在读…' : `${all.length} 条 · 一字未改的原话`}
            </Text>
          </View>
        </View>

        <View style={s.compose}>
          <TextInput
            style={s.composeInput}
            value={draft}
            onChangeText={(v) => {
              setDraft(v);
              if (postErr) setPostErr(null);
            }}
            placeholder="写点你自己的"
            placeholderTextColor={C.placeholder}
            multiline
            textAlignVertical="top"
            autoComplete="off"
            textContentType="none"
            editable={!posting}
          />
          <Pressable
            style={[s.composeBtn, (!draft.trim() || posting) && s.composeBtnOff]}
            onPress={submit}
            disabled={!draft.trim() || posting}
            accessibilityRole="button"
          >
            <Text style={s.composeBtnText} allowFontScaling={false}>
              {posting ? '记…' : '记一条'}
            </Text>
          </Pressable>
          {postErr ? (
            <Text style={s.postErr} allowFontScaling={false}>
              {postErr}
            </Text>
          ) : null}
          {corpusErr ? (
            <Text style={s.postErr} allowFontScaling={false}>
              {corpusErr}
            </Text>
          ) : null}
        </View>

        {loading && all.length === 0 ? (
          <Text style={s.empty} allowFontScaling={false}>
            正在读我的观点…
          </Text>
        ) : null}

        <View style={s.groupHead}>
          <Text style={s.groupTitle} allowFontScaling={false}>观点库里的观点</Text>
          <Text style={s.groupCount} allowFontScaling={false}>{countText(poolList.length)} 条</Text>
        </View>
        {poolList.length === 0 ? (
          !loading ? <Text style={s.groupEmpty} allowFontScaling={false}>还没有表态</Text> : null
        ) : (
          poolList.map(renderRow)
        )}

        <View style={[s.groupHead, s.groupHeadGap]}>
          <Text style={s.groupTitle} allowFontScaling={false}>我自己写的观点</Text>
          <Text style={s.groupCount} allowFontScaling={false}>{countText(selfList.length)} 条</Text>
        </View>
        {selfList.length === 0 ? (
          !loading ? <Text style={s.groupEmpty} allowFontScaling={false}>还没有自己写的</Text> : null
        ) : (
          selfList.map(renderRow)
        )}
      </ScrollView>

      {onTabPress ? <Dock activeTab={activeTab} onTabPress={onTabPress} /> : null}
    </View>
  );
}

const makeStyles = (C, T, S, R, K) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },

    top: { position: 'relative' },
    shape: {
      height: SHAPE_H,
      marginHorizontal: -S.page,
      backgroundColor: K.brand,
      borderBottomLeftRadius: R.big * 2,
      borderBottomRightRadius: R.big * 2,
    },
    back: {
      position: 'absolute',
      left: 14,
      width: 44,
      height: 44,
      borderRadius: R.capsule,
      backgroundColor: K.edge,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backText: { color: C.ink, ...T.title, marginTop: -2 },
    headText: { position: 'absolute', left: S.page, right: S.page },
    title: { color: K.onBrand, ...T.display },
    subTitle: { marginTop: S.x1, color: K.onBrand, opacity: 0.78, ...T.meta, fontWeight: '500' },

    compose: { marginTop: S.x4, marginHorizontal: S.page, backgroundColor: C.card, borderRadius: R.small, padding: S.x4 },
    composeInput: {
      minHeight: 84,
      backgroundColor: C.card2,
      borderRadius: R.small,
      padding: S.x3,
      color: C.ink,
      ...T.body,
      textAlignVertical: 'top',
    },
    composeBtn: {
      marginTop: S.x2,
      alignSelf: 'flex-end',
      height: 44,
      paddingHorizontal: S.x5,
      borderRadius: R.capsule,
      backgroundColor: K.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    composeBtnOff: { opacity: 0.45 },
    composeBtnText: { color: K.onBrand, ...T.title },
    postErr: { marginTop: S.x2, color: C.bad, ...T.meta },

    empty: { marginTop: S.x4, marginHorizontal: S.page, color: C.ink2, ...T.body },
    groupHead: {
      marginTop: S.x6,
      marginHorizontal: S.page,
      minHeight: 64,
      backgroundColor: C.card,
      borderRadius: R.small,
      paddingHorizontal: S.x4,
      paddingVertical: S.x3,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    groupHeadGap: { marginTop: S.x6 },
    groupTitle: { color: C.ink, ...T.title },
    groupCount: { color: C.ink3, ...T.meta },
    groupEmpty: { marginTop: S.x2, marginHorizontal: S.page, color: C.ink3, ...T.meta },

    cardWrap: { marginTop: S.x3, marginHorizontal: S.page, backgroundColor: C.card, borderRadius: R.small, overflow: 'hidden' },
    row: { padding: S.x4 },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: S.x2 },
    kindPill: { height: 20, paddingHorizontal: S.x2, borderRadius: R.capsule, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
    kindText: { color: C.ink2, ...T.meta },
    rowTitle: { flex: 1, color: C.ink, ...T.title },
    rowScore: { ...T.meta, fontWeight: '700' },

    detail: { paddingHorizontal: S.x4, paddingBottom: S.x4 },
    muted: { color: C.ink2, ...T.meta },
    detailLabel: { color: C.ink2, ...T.meta, fontWeight: '500', marginBottom: S.x1 },
    origin: { backgroundColor: C.card2, borderRadius: R.small, padding: S.x4 },
    originText: { color: C.ink, ...T.body },
    detailMeta: { marginTop: S.x2, color: C.ink3, ...T.meta },
    reviewWrap: { marginTop: S.x3 },
    acts: { marginTop: S.x3, flexDirection: 'row', flexWrap: 'wrap', gap: S.x2 },
    actBtn: { height: 32, paddingHorizontal: S.x3, borderRadius: R.capsule, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
    actText: { color: C.ink, ...T.meta, fontWeight: '500' },
  });
