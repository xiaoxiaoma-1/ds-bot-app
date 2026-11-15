import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet } from 'react-native';

/**
 * 全局「点哪儿都只收键盘」（2026-11-15，老板定的通用规则）：
 *
 *   打字的时候想收键盘，随便点哪个地方（哪怕那块正好是个按钮）都只收键盘，
 *   这次点击不往下传；键盘收起之后再点，才是真点按钮。
 *
 * 做法：键盘弹起时盖一层透明可点层，吞掉第一次点击，只做 Keyboard.dismiss()。
 * 挂一次、全 App 生效，不在每一屏各写一份。
 *
 * 时序（2026-11-15 修正）：iOS 用 keyboardWillShow —— 键盘**开始起**就盖层。
 * 之前用 keyboardDidShow（动画结束才触发），起键盘那 ~250ms 里点列表会穿透，
 * 表现就是「点一下跳进书里去了」。安卓没有 will* 事件，仍用 did*。
 */
const SHOW_EVENT = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

export default function KeyboardDismissOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const subShow = Keyboard.addListener(SHOW_EVENT, () => setVisible(true));
    const subHide = Keyboard.addListener(HIDE_EVENT, () => setVisible(false));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  if (!visible) return null;

  return (
    <Pressable
      style={[StyleSheet.absoluteFill, { zIndex: 999 }]}
      onPress={() => Keyboard.dismiss()}
      // 只吞这一下；不需要滑动、也不需要焦点
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
