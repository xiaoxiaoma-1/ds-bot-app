import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';
import { advisors } from '../api';

// 功能一：Bot 列表。数据来自 GET /api/dsbot/advisors -> {id, name, role, status, activity?, tool?, since?}
//
// 四态分开显示（第一版把它们混成一个空列表，看不出到底错在哪）：
//   loading  —— 还在拉
//   failed   —— 拉取失败，写出「哪一步 + 原始错误」并给重试按钮
//   empty    —— 拉成功了，但一个顾问都没有
//   list     —— 有数据
// 顶部用 insets.top 让开状态栏/灵动岛。

// 后端 2026-11-12 起每条 advisor 带 status：busy / idle / unknown；
// busy 时附 activity（正在做什么）、tool（用哪个工具）、since（毫秒时间戳）。
function statusText(item) {
  const st = String(item.status || 'unknown');
  if (st === 'busy') {
    const extra = item.tool || item.activity || '';
    return extra ? `在忙 · ${extra}` : '在忙';
  }
  if (st === 'idle') return '空闲';
  return '状态未知';
}

function dotColor(st) {
  const v = String(st || 'unknown');
  if (v === 'busy') return C.accent;
  if (v === 'idle') return C.good;
  return C.ink3;
}

export default function BotListScreen({ onOpen, onSettings }) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null); // { step, message }
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const list = await advisors();
      setRows(list);
      setErr(null);
    } catch (e) {
      setRows([]);
      setErr({ step: e.step || 'list', message: e.message || '未知错误' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const stepLabel = {
    login: '登录失败',
    auth: '认证失败',
    list: '取顾问列表失败',
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.head}>
        <Text style={s.title} allowFontScaling={false}>
          顾问
        </Text>
        <Pressable onPress={onSettings} hitSlop={12}>
          <Text style={s.gear} allowFontScaling={false}>
            设置
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.accent} />
          <Text style={s.centerText} allowFontScaling={false}>
            正在取顾问列表
          </Text>
        </View>
      ) : err ? (
        <View style={s.errBox}>
          <Text style={s.errTitle} allowFontScaling={false}>
            {stepLabel[err.step] || '出错了'}
          </Text>
          <Text style={s.errMsg} allowFontScaling={false}>
            {err.message}
          </Text>
          <View style={s.errActions}>
            <Pressable style={s.errBtn} onPress={() => load(false)}>
              <Text style={s.errBtnText} allowFontScaling={false}>
                重试
              </Text>
            </Pressable>
            <Pressable style={[s.errBtn, s.errBtnGhost]} onPress={onSettings}>
              <Text style={[s.errBtnText, s.errBtnGhostText]} allowFontScaling={false}>
                去改地址/口令
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(it) => String(it.id)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={C.ink2}
            />
          }
          ListEmptyComponent={
            <View style={s.center}>
              <Text style={s.emptyTitle} allowFontScaling={false}>
                一个顾问都没有
              </Text>
              <Text style={s.centerText} allowFontScaling={false}>
                列表拉取成功，但电脑那边返回的是空数组
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable style={s.row} onPress={() => onOpen(item)}>
              <View style={s.avatar}>
                <Text style={s.avatarText} allowFontScaling={false}>
                  {String(item.name || '?').slice(0, 1)}
                </Text>
              </View>
              <View style={s.rowBody}>
                <Text style={s.name} numberOfLines={1} allowFontScaling={false}>
                  {item.name}
                </Text>
                <View style={s.metaRow}>
                  <View style={[s.dot, { backgroundColor: dotColor(item.status) }]} />
                  <Text style={s.status} numberOfLines={1} allowFontScaling={false}>
                    {statusText(item)}
                  </Text>
                </View>
                <Text style={s.role} numberOfLines={1} allowFontScaling={false}>
                  {item.role || '顾问'}
                </Text>
              </View>
              <Text style={s.chev} allowFontScaling={false}>
                ›
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 10,
  },
  title: { color: C.ink, fontSize: 22, fontWeight: '700', lineHeight: 28 },
  gear: { color: C.ink2, fontSize: 14, lineHeight: 20 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 10 },
  centerText: { color: C.ink3, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  emptyTitle: { color: C.ink2, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  errBox: {
    margin: 16,
    padding: 16,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    gap: 8,
  },
  errTitle: { color: C.bad, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  errMsg: { color: C.ink, fontSize: 13, lineHeight: 20 },
  errActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  errBtn: {
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  errBtnText: { color: '#fff', fontSize: 13, fontWeight: '600', lineHeight: 18 },
  errBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line },
  errBtnGhostText: { color: C.ink2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomColor: C.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.card2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: C.ink, fontSize: 16, fontWeight: '600', lineHeight: 22 },
  rowBody: { flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  status: { color: C.ink2, fontSize: 12, lineHeight: 16, flexShrink: 1 },
  name: { color: C.ink, fontSize: 16, fontWeight: '600', lineHeight: 22 },
  role: { color: C.ink2, fontSize: 12, lineHeight: 17, marginTop: 2 },
  chev: { color: C.ink3, fontSize: 20, lineHeight: 24 },
});
