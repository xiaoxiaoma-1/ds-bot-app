// 带本地缓存的图片（2026-11-15）
// 用法和 <Image> 一样，只是 src 会先换成磁盘里那份，没有再下。
// 头像 / 朋友圈图都用它：老板退出去再进来不该重新等一次。
import { memo, useEffect, useState } from 'react';
import { Image } from 'react-native';
import { cachedImageUri, memImageUri } from '../imgCache';

function CachedImage({ uri, style, resizeMode, onLoad, ...rest }) {
  // 首帧就用内存里已知的本地路径，避免「先白一下再出来」
  const [src, setSrc] = useState(() => memImageUri(uri) || uri);

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
