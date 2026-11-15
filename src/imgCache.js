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

export function memImageUri(url, w) {
  const u = withWidth(url, w);
  return (u && mem.get(u)) || '';
}

// 2026-11-15（老板报「进去要等一会儿才出头像」）：
// fileName 是纯函数（url 哈希），所以磁盘路径**同步**就能算出来。
// 以前第一帧只能拿到远程 url → 空白，必须等 cachedImageUri 异步 getInfoAsync 回来才换成本地。
// 现在先按算出来的路径直接渲染，文件在就直接出、不在就由 Image 自己失败后回退（见 CachedImage）。
// 2026-11-15（老板：「朋友圈点进去太慢了，是太慢了不是不显示」）：
// 原图 2.4MB，手机上下载+解码要几秒。服务端已支持 ?w= 出缩略图（2.4MB → 17KB，小 134 倍），
// 这里给宽高限制的地方默认走 300 宽的缩略图，点开大图才用原图。
export const THUMB_W = 300;

function withWidth(url, w) {
  if (!url || !w) return url;
  if (!/^https?:/i.test(url)) return url;
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'w=' + w;
}

export function guessedLocalUri(url, w) {
  const u = withWidth(url, w);
  if (!u || !DIR) return '';
  if (mem.has(u)) return mem.get(u);
  if (!/^https?:/i.test(u)) return u;
  return DIR + fileName(u);
}

export async function cachedImageUri(rawUrl, w) {
  const url = withWidth(rawUrl, w);
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
