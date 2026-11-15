// 图片本地缓存（2026-11-15）
// 老板的要求：头像、朋友圈图片「第一次加载出来之后，没改设置就一直在手机上，不用每次重等」。
//
// 为什么不用 expo-image：本项目没装它（package.json 里只有 expo-file-system / expo-image-picker /
// expo-video / async-storage），装新依赖要重新出包，本轮不许出包。所以用已经有的
// expo-file-system 把图下到 documentDirectory，之后直接拿 file:// 那个路径渲染。
//
// 命中顺序：内存 → 磁盘已有文件 → 网络下载并落盘 → 失败才退回远程 url（宁可慢一点，也不白屏）。
import * as FileSystem from 'expo-file-system';

const DIR = FileSystem.documentDirectory ? FileSystem.documentDirectory + 'imgcache/' : '';
const mem = new Map();

// 稳定的文件名：同一 url 永远同一个文件，不会越攒越多
function fileName(url) {
  let h = 0;
  for (let i = 0; i < url.length; i += 1) {
    h = (h * 31 + url.charCodeAt(i)) | 0;
  }
  const tail = (url.split('?')[0].split('.').pop() || 'jpg').slice(0, 4).replace(/[^a-z0-9]/gi, '');
  return 'i' + Math.abs(h).toString(36) + '.' + (tail || 'jpg');
}

export function memImageUri(url) {
  return (url && mem.get(url)) || '';
}

export async function cachedImageUri(url) {
  if (!url || !DIR) return url;
  if (mem.has(url)) return mem.get(url);
  if (!/^https?:/i.test(url)) return url; // 已经是本地路径
  const path = DIR + fileName(url);
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (info && info.exists && info.size > 0) {
      mem.set(url, path);
      return path;
    }
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    const res = await FileSystem.downloadAsync(url, path);
    if (res && res.status === 200) {
      mem.set(url, res.uri || path);
      return res.uri || path;
    }
    return url;
  } catch (e) {
    // 下载失败不抛：退回远程 url，页面不至于整块空白
    return url;
  }
}
