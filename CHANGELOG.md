# CHANGELOG

## 0.2.5 — 2026-11-12（会话页接 SSE 流式）

### 改了哪几个文件

- `src/sse.js`（新增，4554 字节 / 159 行）—— SSE 解析 + 重连，纯 JS、不 import RN、不加原生模块，所以能直接在 Node 里用同一份代码自测。
  - `splitFrames` / `parseFrame`：按空行切帧，忽略 `:` 心跳，支持多行 `data`
  - `createFeed({url, token, xhrFactory, onEvent, onError, onAuthFail})`：XHR + `onprogress` 攒 buffer 自己切块；断线 2 秒退避重连、连续失败翻倍到 10 秒；收到 `hello` 把退避归位；401/403 不重连，直接回调 `onAuthFail`
- `src/api.js`（7875 字节 / 233 行）—— `openFeed()` 委托 `createFeed`，端点改 `GET /api/dsbot/feed`，带 Bearer，`onAuthFail` 转成 `ApiError(step:'auth')`
- `src/screens/ChatScreen.js`（9837 字节 / 309 行）—— 进页挂流、离页关流；`stream` 的 `phase:start → text 增量 → phase:end` 拼进当前气泡；`message` 按 `seq` 去重并替换本地乐观气泡；`hello` 回来时用 `/api/dsbot/chat` 补齐断线期间的消息

### 自测（真服务端 127.0.0.1:8788，脚本复用 APP 的 src/sse.js）

```
login: status=200 ok=true sessionLen=43
空闲顾问 29 个，选中：测试（session-ef474deb-…）
A 场景：增量 1 片 @ 4212ms，累计「好」
PASS 验收1 逐字上屏 :: 客户端先渲染本地气泡，随后收到 1 片增量；服务端最后一条「好」
PASS 验收2 内容与服务端一致、不重复 :: 流「好」 vs /chat「好」 严格相等=true
PASS 验收1b 长回复多片增量 :: 20 片，3764ms→4348ms（end 4363ms），间隔[3764,16,16,51,15,41,29,38,28,27,37,29,33,34,27,35,29,30,51,18]
PASS 验收2b 长回复与服务端严格一致 :: 流 83 字 / 服务端 83 字，相等=true
PASS 验收3b 重新连上并续流 :: 第二次连接 hello 收到 1 次
PASS 验收4 401 不重连、落到重新登录 :: onAuthFail=1 次，attempt=1，仍在排重连=false
开流后: {"closed":false,"delay":2000,"attempt":0,"hasTimer":false,"bufferLen":0}
关闭后: {"closed":true,"delay":2000,"attempt":0,"hasTimer":false,"bufferLen":0}
```

### 未动

`package.json`、`app.json`、`.github/workflows/`、`README.md` 一个字节没改；没加任何原生模块。

---

## 0.2.4 — 2026-11-12（列表页接 status 字段）
