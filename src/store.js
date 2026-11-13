import * as SecureStore from 'expo-secure-store';

// 三条红线之一：口令与会话凭证只进 SecureStore，绝不写进代码、绝不落普通存储。
// 三条红线之二：服务地址不写死，由用户在首屏输入后同样存 SecureStore。
const K = {
  base: 'dsbot.base',
  pass: 'dsbot.pass',
  sess: 'dsbot.sess',
};

export const DEFAULT_BASE = 'https://user-20260813ol.tail1bd429.ts.net';

export async function getBase() {
  return (await SecureStore.getItemAsync(K.base)) || DEFAULT_BASE;
}

export async function setBase(v) {
  await SecureStore.setItemAsync(K.base, String(v || '').trim().replace(/\/+$/, ''));
}

export async function getPass() {
  return (await SecureStore.getItemAsync(K.pass)) || '';
}

export async function setPass(v) {
  await SecureStore.setItemAsync(K.pass, String(v || ''));
}

export async function getSess() {
  return (await SecureStore.getItemAsync(K.sess)) || '';
}

export async function setSess(v) {
  if (v) await SecureStore.setItemAsync(K.sess, String(v));
  else await SecureStore.deleteItemAsync(K.sess);
}

export async function isConfigured() {
  const [base, pass] = await Promise.all([getBase(), getPass()]);
  return Boolean(base && pass);
}

export async function clearAll() {
  await Promise.all([
    SecureStore.deleteItemAsync(K.base),
    SecureStore.deleteItemAsync(K.pass),
    SecureStore.deleteItemAsync(K.sess),
  ]);
}
