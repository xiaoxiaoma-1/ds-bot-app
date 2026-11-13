import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 内存缓存 - 快速命中，启动时异步从磁盘预热
const memory = new Map();

// 磁盘 key 前缀
const PREFIX = 'dscache:';

function diskKey(key) {
  return PREFIX + key;
}

/**
 * 异步初始化：App 启动后调一次，将已存的磁盘数据读入内存（不阻塞渲染）。
 */
export async function warmCache() {
  const keys = await AsyncStorage.getAllKeys();
  const cacheKeys = keys.filter(k => k.startsWith(PREFIX));
  if (cacheKeys.length === 0) return;
  const results = await AsyncStorage.multiGet(cacheKeys);
  for (const [key, json] of results) {
    if (!json) continue;
    try {
      const { data, at } = JSON.parse(json);
      memory.set(key.slice(PREFIX.length), { data, at });
    } catch {
      // JSON 损坏或格式不符 → 丢弃
    }
  }
}

function getCached(key) {
  return memory.get(key) || null;
}

/**
 * 双写缓存：同步更新内存，异步写入磁盘。
 * @param {string} key 业务 key（不含前缀）
 * @param {any} data 任意 JSON 可序列化的数据
 */
export function setCached(key, data) {
  const entry = { data, at: Date.now() };
  memory.set(key, entry);
  AsyncStorage.setItem(diskKey(key), JSON.stringify(entry)).catch(() => {
    // 磁盘写入失败静默忽略，内存仍然有效
  });
}

/**
 * 带缓存的资源 Hook（内存 + 磁盘）。
 * @param {string} key 缓存标识，例如 'home:board'、'advisors'、'chat:<botId>'
 * @param {() => Promise<any>} loader 没有缓存或主动刷新时执行
 * @param {object} [opts]
 * @param {boolean} [opts.refreshOnMount] 默认 true，挂载时后台静默刷新
 * @returns {{ data: any, loading: boolean, error: string | null }}
 */
export function useCachedResource(key, loader, opts = {}) {
  const { refreshOnMount = true } = opts;
  const hit = getCached(key);

  const [state, setState] = useState(() => ({
    // ★ 第一帧：内存有缓存就不 loading，用户无感
    data: hit ? hit.data : null,
    loading: !hit,
    error: null,
  }));

  useEffect(() => {
    let alive = true;

    const refresh = async () => {
      try {
        const data = await loader();
        if (!alive) return;
        // 成功 → 双写，静默替换
        setCached(key, data);
        setState({ data, loading: false, error: null });
      } catch (e) {
        if (!alive) return;
        // ★ 失败时保持旧数据（如果有），不覆盖成错误态
        setState((p) =>
          p.data != null
            ? { ...p, loading: false }
            : { data: null, loading: false, error: String(e && e.message || e) }
        );
      }
    };

    // 没有缓存 → 必须加载，用户会看到第一次 loading
    if (!hit) {
      refresh();
    }
    // ★ 有缓存时，仍然可选后台静默刷新（用户无感）
    else if (refreshOnMount) {
      refresh();
    }

    return () => {
      alive = false;
    };
  }, [key]);

  return state;
}