# CHANGELOG

## 0.2.0 — 2026-11-12

界面骨架：三个功能全部写进代码，用 Expo + React Native 原生组件渲染（不是 WebView）。

### 新增文件

- `src/store.js` — 服务地址、口令、会话凭证一律走 SecureStore；代码里没有它们的任何字面量。
- `src/api.js` — 网络层。`POST /login {p}` 换 `pocket_sess`；401 时用存下的口令自动重登一次（2 小时过期对用户无感）；已实现通用透传 `botCall(endpoint, payload)` 与 SSE `openFeed()`。
- `src/theme.js` — 深色配色常量。
- `src/screens/SetupScreen.js` — 首屏：填服务地址 + 口令，校验后登录。
- `src/screens/BotListScreen.js` — 功能一：顾问列表，下拉刷新，点进去开会话。
- `src/screens/ChatScreen.js` — 功能二 + 三：历史消息、发送、流式回复（SSE，失败自动降级轮询）。
- `App.js` — 三个页面用状态切换，不引入导航库。

### 依赖变更

- 新增 `expo-secure-store`。**必要**：红线要求凭据存 SecureStore，这是 Expo 官方的钥匙串封装，无法用零依赖方式等价替代。

### 用到的接口（与电脑侧现有实现对照）

| 用途 | 现在真的能调 | 备注 |
|---|---|---|
| 登录 | `POST /login {p}` → `Set-Cookie: pocket_sess`（2h, HttpOnly） | `mobile_server.py:2441-2477` |
| Bot 列表 | `GET /api/dsbot/advisors` → `{id,name,role}` | `mobile_server.py:2724` |
| 会话历史 | `GET /api/dsbot/chat?bot=<id>` → `{messages:[{who,text,at}]}` | `mobile_server.py:2768` |
| 发消息 | `POST /api/dsbot/send {bot,text}` | `mobile_server.py:2537` |
| 流式 | 目标是 `GET /api/bot/feed`（SSE） | **代理层还没有这条路由** |

### 缺口（需要电脑侧补，属于别人那一摊，我不自己造后端）

1. **通用透传**：`POST /api/bot`（body `{endpoint,payload}`，先过 `pocket_sess` 再调本机 `_dsbot_call`）。现在 `_dsbot_call` 只是内部函数，HTTP 层没有暴露，所以 APP 只能调上面三条包装路由。
2. **状态字段**：`/api/dsbot/advisors` 只吐 `id/name/role`，把 `state` 里的状态丢了。APP 首屏要显示「在忙/空闲」，需要它把 `status` 一起带出来。
3. **分页游标**：`/api/dsbot/chat` 丢掉了 `chat` 端点返回的 `cursor`，所以「往上翻更早」现在做不了，界面上先挂着一条禁用提示。
4. **SSE 透传**：`GET /api/bot/feed` 需要代理层做流式转发（不能先缓冲再返回），否则流式只能靠轮询降级。

在上面 1 和 4 补上之前，功能一、二、三都能跑，只是：没有状态点、不能翻更早、回复不是逐字而是一段一段。

### 待验证

1. RN 里 `Set-Cookie` 能否读到 —— 读到就手动带 `Cookie` 头；读不到就靠系统 cookie jar（`credentials: 'include'`）。两条路都写了，实际走哪条要真机看。
2. XHR 的 `onprogress` 在 iOS 上对 `text/event-stream` 是否逐块触发。
3. `state` 返回里 bot 的状态字段名（`status`？）尚未逐字核对。
