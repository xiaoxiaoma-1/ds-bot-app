# CHANGELOG

## 0.2.3 — 2026-11-12（认证走 Bearer，接口已用 curl 实测）

### 改法

- `login()` 读响应体的 `session`（43 位不透明随机串），存 SecureStore。
- 之后每个请求带 `Authorization: Bearer <session>`；同时仍带 `Cookie`，给旧版服务端留兼容，两个都在不冲突。
- `ttl` 7200 秒，收到 401 自动重登一次再重发原请求。
- `openFeed()` 的 SSE 请求同样带 Bearer。

### curl 实测记录（本机 8788，2026-11-12）

| 请求 | 结果 |
|---|---|
| `POST /login` body `{"p":"…"}` | `ok=True`、`ttl=7200`、响应体带 `session`，长度 43 |
| `GET /api/dsbot/advisors`，**只带** `Authorization: Bearer <session>`、不带任何 cookie | **200**，返回 `{"ok": true, "advisors": [...]}` |
| 同上，Bearer 乱写 | **401** |

> 附一条踩坑：用 PowerShell 的 `curl.exe -d '<json>'` 传 JSON 时，引号会被 PowerShell 5.1 吃掉，服务端收到空 body，表现是「口令不对」。改用 `--data-binary "@文件"` 就正常。这是工具链问题，不是接口问题——「口令不对」不代表口令错。

---

## 0.2.2 — 2026-11-12（认证改优先读响应体 + 依赖版本对齐）
