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
import { C } from '../theme';
import { advisors } from '../api';

// 功能一：Bot 列表。数据来自 GET /api/dsbot/advisors -> {id, name, role}
// 注意：状态字段代理层现在没吐（只给 id/name/role），所以这里用 role 占位，
// 等代理层补上 status 再显示真实状态点（见 CHANGELOG 缺口二）。
export default function BotListScreen({ onOpen, onSettings }) {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const list = await advisors();
      setRows(list);
      setErr('');
    } catch (e) {
      setErr(e.message || '拉不到列表');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <View style={s.head}>
        <Text style={s.title}>顾问</Text>
        <Pressable onPress={onSettings} hitSlop={12}>
          <Text style={s.gear}>设置</Text>
        </Pressable>
      </View>

      {err ? <Text style={s.err}>{err}</Text> : null}

      <FlatList
        data={rows}
        keyExtractor={(it) => String(it.id)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.ink2} />
        }
        ListEmptyComponent={<Text style={s.empty}>一个顾问都没有</Text>}
        renderItem={({ item }) => (
          <Pressable style={s.row} onPress={() => onOpen(item)}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{String(item.name || '?').slice(0, 1)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={s.role} numberOfLines={1}>
                {item.role || '顾问'}
              </Text>
            </View>
            <Text style={s.chev}>›</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 10,
  },
  title: { color: C.ink, fontSize: 26, fontWeight: '700' },
  gear: { color: C.ink2, fontSize: 14 },
  err: { color: C.bad, fontSize: 13, paddingHorizontal: 18, paddingBottom: 8 },
  empty: { color: C.ink3, fontSize: 14, textAlign: 'center', marginTop: 40 },
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
  avatarText: { color: C.ink, fontSize: 16, fontWeight: '600' },
  name: { color: C.ink, fontSize: 16, fontWeight: '600' },
  role: { color: C.ink2, fontSize: 12, marginTop: 3 },
  chev: { color: C.ink3, fontSize: 22 },
});
