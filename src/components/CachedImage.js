// 带本地缓存的图片（2026-11-15）
// 用法和 <Image> 一样，只是 src 会先换成磁盘里那份，没有再下。
// 头像 / 朋友圈图都用它：老板退出去再进来不该重新等一次。
import { memo, useEffect, useState } from 'react';
import { Image } from 'react-native';
import { cachedImageUri, guessedLocalUri, memImageUri } from '../imgCache';

function CachedImage({ uri, style, resizeMode, onLoad, ...rest }) {
  // 2026-11-15（老板报「切回来头像又没了、又要等」）：
  // 首帧直接用「算出来的磁盘路径」——以前只有内存命中才敢用，没命中就先给远程 url，
  // 于是每次进页面都要重新走网络。现在路径同步就能算，文件在就立刻显示。
  const [src, setSrc] = useState(() => guessedLocalUri(uri) || uri);

  useEffect(() => {
    let alive = true;
    if (!uri) return () => { alive = false; };
    const known = memImageUri(uri);
    if (known) {
      setSrc(known);
      return () => { alive = false; };
    }
    setSrc(uri);
    cachedImageUri(uri).then((local) => {
      if (alive && local) setSrc(local);
    });
    return () => { alive = false; };
  }, [uri]);

  if (!src) return null;
  return <Image source={{ uri: src }} style={style} resizeMode={resizeMode} onLoad={onLoad} {...rest} />;
}

export default memo(CachedImage);
