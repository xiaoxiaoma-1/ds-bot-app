# CHANGELOG

## 0.3.2 — 2026-11-14（真机 22 条问题修复）

### 首页

- **三屏横向滚动恢复**：`HomeScreen.js` 三张 HeroCard 放进 `horizontal` ScrollView，`snapToInterval={heroSnap}`；卡宽改成 `winWidth - S.page*2 - S.x3`，让下一张露边；`minHeight` 280 → 220。
- **选题池读取超 1 分钟**：`App.js` 里三个互相覆盖 `loading` 的 `useEffect` 并成一个派生值 `const loading = !topics && !cachedTopics.error`。
- **「接着写」跳错页**：`openDraft` 从 `go('DraftLibrary')` 改成 `go('MyViews')`。
- **今日灵感数据不来 / 自己的观点混进观点库**：`homeData.js:loadIdeas` 打的是 `/api/dsh-media/views/list`（`my_views` 表，实测 total=2），改成 `/api/list`（`atoms` 表，实测 left=13477）；字段 `d.views{title,content}` → `d.items{id,author,claim}`；`total` 取 `d.left`。
- **今日灵感点进去先显示那 3 条并直接左右滑**：`ViewsPoolScreen` 新增 `autoSwipe`（签名默认值 + `useState` 初值 + 数据到达后自动切 `swipe` 的 `useEffect`），`App.js` 的 `ViewsPoolRoute` 传 `autoSwipe={Boolean(selected && selected.length)}`；首屏 `limit` 从 20 提到 120 以便筛到那 3 条，删掉 `getMyView(id)` 补条死循环（它查 `my_views`，atoms id 永远查不到）。

### 工作台

- 删掉「今日完成」「回稿库接着写」两个板块（96 行删除）。
- 「今天先做」气泡 `height: 124 → 260`，占满空出来的位置。

### 观点库 / 书库 / 语料库

- **语料库报错 `cannot access local variable 'unquote'`**（后端）：`mobile_server.py` 的 `do_GET` 内有一条函数内局部 `import unquote`，使 `unquote` 成为函数局部名，`/api/dsbot/avatar/`、`/api/dsh-media/` 在其之前引用即抛 `UnboundLocalError`。删掉该行（模块顶层已有 import）。**一个 bug 同时打死语料库、书库、今日灵感、观点库四个入口。**
- 书库搜索框 + 列表两处 `TouchableWithoutFeedback onPress={Keyboard.dismiss}`。
- 读书器：删掉红色调试条；错误态加「点这里重试」，`App.js` 的 `BookReaderRoute` 把一次性 `useEffect` 提成 `reload` + `useRef` 卸载保护，并传 `onRetry={reload}`；保留 `savedIdx` 夹取、跳转失败退回第一段、错误信息带 `bookId · offset=0 · limit=20 ·` 前缀。

### 能力表达

- 训练历史：`AsyncStorage` 存最近 30 条，输入页列出「过往训练」，左滑露出删除；返回键改成 `marked → input`（回输入页看历史），再按一次才退出。
- 金句 / 可删：新接 `/api/expression/marks`（`golden` 映射成 `gold`），实测返回 `marks=2`。

### 顾问 / 我的 / 群聊

- **顾问头像颜色丢失**：0.3.1 里是写死的 `const tint = '#FFFFFF'`，改成 `avatar.color ? avatarInk(avatar.color, scheme) : C.ink2`，并去掉头像外框的 `backgroundColor: C.hero`。
- **浅色模式底部 tab 隐形**：`dockOn` 与 dock 底色同源，WCAG 对比度 **1.02:1**。dock 底改 `C.hero`，`DockItem` 收 `dockOn`/`dockIdle`（走 `useRoles()`），`theme.js` 两个 palette 各加 `dockIdle: '#9A9A9A'`。改后深色 18.71/6.65、浅色 16.96/6.03。
- **团队管理页转很久最后「0 个」黑屏**：`loading && bots.length === 0 && !err` 才转圈（有缓存直接出列表）、错误块带「重试」按钮（`s.btn + s.btnPrimary`）、空态提示；顺带把不存在的主题键 `C.danger` / `C.dangerLight` 改回 `C.bad` / `C.card`。
- **群聊输入条没对齐 / 发送框超出屏幕**：`paddingBottom` 的 `+ S.x6` 改成 `+ S.x2`（和 `ChatScreen` 一致），`input` 补齐 `minHeight: 44`。
- **「我的观点」写字栏被键盘挡住**：`KeyboardAvoidingView` + `maxHeight: 120`，聚焦时 `onContentSizeChange` 自动滚到底。

### 上传

- **换头像 / 发朋友圈上传失败**：Expo 57 的 `winter/fetch` 的 `FormData` 只认 `string` / `Blob` / 有 `bytes()` 的对象，RN 老写法 `{uri,type,name}` 必抛 `Unsupported FormDataPart implementation`（`convertFormData.ts:77`，官方测试用例名就叫 `should throw an error if the react-native FormData passing an uri`）。改用 `expo-file-system` 的 `File`（`new File(uri)`，实现 `bytes()`，命中第三分支）；`file.exists`（`NativeFileSystem.types.d.ts:172`）与 `file.size`（:222）分开报错，并加一行 `console.log('[upload]', {uri,exists,size,type,name})` 便于定位。
- 新增依赖 `expo-file-system@~57.0.7`（`npx expo install` 装的）。

### 未动

`app.json`、`.github/workflows/`、`ProfileScreen.js`（老板明令「我的」UI 已定死）。

---

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
