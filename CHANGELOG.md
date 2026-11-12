# CHANGELOG

## 0.2.1 — 2026-11-12（真机三处 bug 修复）

### 1. 顶栏钻到状态栏下面

**成因**：第一版三个页面都是裸 `View` + 写死的 `paddingTop`（10/12/14），没有任何安全区处理。Expo 58 / RN 0.88 默认整屏铺满（不自动避让），页面从 y=0 开始画，标题就压在状态栏和灵动岛区域上，右侧内容撞到信号/电池。

**修法**：引入 `react-native-safe-area-context`，`App.js` 最外层包 `SafeAreaProvider`，每个页面用 `useSafeAreaInsets()` 取 `insets.top` 当头部 `paddingTop`，输入区用 `insets.bottom`。

### 2. 字号失控

**成因**：iOS 的 Dynamic Type 默认开启，RN 的 `<Text>` 默认 `allowFontScaling = true`，系统字号一放大，标题会被乘到两三倍；而四周 padding、行高是固定值，不跟着放大，于是文字压住下面那一行。这是「字号被放大 + 间距固定」两个因素叠加，不是某个 Text 漏设 `fontSize`（代码里每一处都设了，我逐行核过）。

**修法**：所有文本显式 `allowFontScaling={false}`，并逐处补 `lineHeight`；标题从 26pt 降到 22pt。

### 3. 列表空 + 一直「未登录」

**成因两个，叠在一起**：

- **认证没真成**：第一版登录用 `fetch`，靠 `res.headers.get('set-cookie')` 取 `pocket_sess`。RN 在 iOS 上不把这个头暴露给 JS，会话凭证根本没存下来；后面每个请求都没 cookie，服务端一律回 401，界面就停在「未登录」。
- **错误被吞进空列表**：列表页只有一个 `err` 字符串，且渲染时先看 `rows.length === 0` 就画「一个顾问都没有」，错误提示和空态挤在一起，看上去像「列表就是空的」。

**修法**：

- 登录改走 `XMLHttpRequest`，用 `getAllResponseHeaders()` 取 `Set-Cookie`；拿到 `pocket_sess` 存 SecureStore，之后每个请求显式带 `Cookie` 头；401 时用存下的口令自动重登一次。
- 新增 `ApiError`，带 `step` 字段（`login` / `auth` / `list` / `chat` / `send` / `feed`）。
- 列表页拆四态：**加载中 / 失败（写明哪一步 + 原始错误 + 重试 + 去改地址）/ 空列表（明说「拉取成功但返回空数组」）/ 有数据**。空态与未登录不再混淆。
- 对话页同样显示分步错误，「更早历史」保持为明说的禁用提示。

### 依赖变更

- 新增 `react-native-safe-area-context@~5.11.1`（用 `npx expo install` 装的、Expo 为 SDK 58 钉的版本）。**必要**：安全区 inset 只能由它提供，RN 自带 `SafeAreaView` 在新架构下已弃用且拿不到 inset 数值。

### 待验证

1. XHR 的 `getAllResponseHeaders()` 在 iOS 27.2 上是否真带 `Set-Cookie`（本轮修复的核心假设，需真机确认）。
2. XHR 的 `onprogress` 对 `text/event-stream` 是否逐块触发。
3. `state` 返回里 bot 的状态字段名尚未逐字核对。

---

## 0.2.0 — 2026-11-12

界面骨架：三个功能全部写进代码，用 Expo + React Native 原生组件渲染（不是 WebView）。

### 新增文件

- `src/store.js` — 服务地址、口令、会话凭证一律走 SecureStore。
- `src/api.js` — 网络层。
- `src/theme.js` — 深色配色常量。
- `src/screens/SetupScreen.js` — 首屏：填服务地址 + 口令。
- `src/screens/BotListScreen.js` — 功能一：顾问列表。
- `src/screens/ChatScreen.js` — 功能二 + 三：历史、发送、流式回复。
- `App.js` — 三页状态切换，不引入导航库。

### 缺口（需电脑侧补，属别人那一摊）

1. `POST /api/bot` 通用透传未暴露
2. `/api/dsbot/advisors` 丢 `status`
3. `/api/dsbot/chat` 丢 `cursor`
4. `GET /api/bot/feed` 未做 SSE 透传
