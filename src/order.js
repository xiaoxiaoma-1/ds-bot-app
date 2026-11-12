import * as SecureStore from 'expo-secure-store';

// 顾问排序存在本机。用 expo-secure-store 而不是 AsyncStorage：后者是原生模块，装上要重新 prebuild；
// secure-store 已经是项目依赖，存一个 id 数组够用。
const KEY = 'dsbot.advisorOrder';

export async function loadOrder() {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveOrder(ids) {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(ids.slice(0, 200)));
  } catch {}
}

// 把已排好的 id 顺序应用到最新列表：排过的按原顺序在前，新出现的追加在末尾。
export function applyOrder(list, order) {
  if (!order.length) return list;
  const byId = new Map(list.map((it) => [String(it.id), it]));
  const out = [];
  for (const id of order) {
    const hit = byId.get(String(id));
    if (hit) {
      out.push(hit);
      byId.delete(String(id));
    }
  }
  for (const it of list) if (byId.has(String(it.id))) out.push(it);
  return out;
}
