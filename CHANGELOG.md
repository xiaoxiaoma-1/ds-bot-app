# CHANGELOG

## 0.2.6 — 2026-11-12（真机三 bug：深浅色 / 输入框悬空 / 滑动粘滞）

> `package.json` 的版本号归打包工程师，本轮未动；这里只记代码变更。

### Bug 1 深浅色不跟随系统

根因三处：`src/theme.js:1-13`（旧）只有一份写死的深色调色板；全仓 `Appearance` / `useColorScheme` 命中数 **0**；三个屏幕的 `StyleSheet.create()` 都在模块顶层执行，颜色被固化。

改法：`theme.js` 拆成 `darkPalette` / `lightPalette` + `ThemeContext` + `ThemeProvider` + `useTheme()`；`App.js:16` 用 `useColorScheme()` 订阅系统外观，`App.js:19` 包 Provider，`App.js:22` StatusBar 跟随；三个屏幕改成 `makeStyles(C)` + `useMemo(() => makeStyles(C), [C])`。深色值一个未改。

### Bug 2 进会话输入框悬在半空

根因：旧 `ChatScreen.js:181-188` 的加载态是一个没有 `flex` 的 `View`，列表缺失时输入栏被文档流顶上去。

改法：消息区恒为 `flex:1` 的 `s.body`，加载指示画在它内部（`ChatScreen.js` 的 `<View style={s.body}>`），输入栏仍是最后一个兄弟节点。

数值证据（Yoga 按两版结构复算，393×852，insets 59/34）：

| 版本 | 加载中 top | 加载完 top | 两态差 |
|---|---|---|---|
| 改前 | 228 | 766 | **538 pt** |
| 改后 | 766 | 766 | **0 pt** |

### Bug 3 滑动粘滞

五项现状（改前）：FlatList ✓；`React.memo` ✗；`renderItem` 内联箭头 ✗；`keyExtractor` 带 index ✗（旧 `ChatScreen.js:192`）；`getItemLayout` ✗；SSE 每片 `text` 都 `setLive`（旧 `:70`）✗。

改后：`AdvisorRow` / `BubbleRow` / `MessageList` 全 `memo`；`renderItem`、`keyExtractor` 均 `useCallback`；Bot 列表加 `getItemLayout`（行定高 `ROW_HEIGHT = 88`）；`ChatScreen` 的流式文本改由 `LiveBubble` 通过 `useImperativeHandle` 局部更新，`requestAnimationFrame` 合并（`ChatScreen.js:93`），父组件在流式期间 **0 次** state 更新。

### 未动

`package.json`、`app.json`、`.github/workflows/`、`README.md`；未改配色与字号（深色调色板逐值保留，浅色为本 bug 修复必需新增）；未加任何原生模块。

---

## 0.2.5 — 2026-11-12（会话页接 SSE 流式）
