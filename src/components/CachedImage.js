// 带本地缓存的图片（2026-11-15）
// 用法和 <Image> 一样，只是 src 会先换成磁盘里那份，没有再下。
// 头像 / 朋友圈图都用它：老板退出去再进来不该重新等一次。
import { memo, useEffect, useState } from 'react';
import { Image } from 'react-native';
import { cachedImageUri, guessedLocalUri, memImageUri } from '../imgCache';

function CachedImage({ uri, style, resizeMode, onLoad, thumbWidth, ...rest }) {
  // 2026-11-15（老板：「朋友圈点进去太慢了，是太慢了不是不显示」）：
  // 传 thumbWidth 就走服务端缩略图（2.4MB → 17KB），列表里的小图用它；
  // 不传就是原图（点开看大图时用）。两套都走磁盘缓存，不重复下载。
  const w = thumbWidth || 0;
  const [src, setSrc] = useState(() => guessedLocalUri(uri, w) || uri);

  useEffect(() => {
    let alive = true;
    if (!uri) return () => { alive = false; };
    const known = memImageUri(uri, w);
    if (known) {
      setSrc(known);
      return () => { alive = false; };
    }
    setSrc(guessedLocalUri(uri, w) || uri);
    cachedImageUri(uri, w).then((local) => {
      if (alive && local) setSrc(local);
    });
    return () => { alive = false; };
  }, [uri, w]);

  if (!src) return null;
  return <Image source={{ uri: src }} style={style} resizeMode={resizeMode} onLoad={onLoad} {...rest} />;
}

export default memo(CachedImage);
