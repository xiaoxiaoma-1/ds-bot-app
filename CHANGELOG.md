# CHANGELOG

## 0.2.4 — 2026-11-12（列表页接 status 字段）

### 改了什么

- `src/screens/BotListScreen.js`：每行第二行改为「状态点 + 状态文案 + 角色」。
  - `status === 'busy'` → 蓝色实心点 + `在忙`；带 `tool` 或 `activity` 时显示 `在忙 · <tool|activity>`
  - `status === 'idle'` → 绿点 + `空闲`
  - `status === 'unknown'` 或字段缺失 → 灰点 + `状态未知`
  - 新增两个纯函数 `statusText(item)` / `dotColor(status)`，渲染处不再内联判断
- 状态行 `numberOfLines={1}`：`tool` 名可能很长，必须单行截断，否则会把右侧箭头挤出屏幕。
- 未改 `src/api.js`：`advisors()` 本来就把每条原样返回，`status` / `activity` / `tool` / `since` 自动带过来。认证自 0.2.3 起已是 `Authorization: Bearer`。

### 自测（本机 8788，curl）

- `POST /login` → `ok=True`、`ttl=7200`、`session` 长度 43
- `GET /api/dsbot/advisors` 只带 `Authorization: Bearer` → `ok=True`、**30 条**
- 每条字段：`activity, id, name, role, since, status, tool`
- 前两条：
  - `{"id":"session-dc24254b-…","name":"小钱来（总经理）","role":"总经理","status":"busy","activity":"sending","tool":"message_bot","since":1794470729918}`
  - `{"id":"session-abe9ae20-…","name":"架构师","role":"架构","status":"idle"}`

### 未动

`package.json`、`app.json`、`.github/workflows/`、`README.md` 一个字节没改。

---

## 0.2.3 — 2026-11-12（认证走 Bearer，接口已用 curl 实测）
