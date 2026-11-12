// 群组数据整形 + 未读聚合。
// 后端 `advisors` 顶层带 `groups`：{id,name,members,admin,mode,notice,seq,preview,unread,hasUnread}。
// 关键约定：**群未读与 bot 未读分开计**。一个群有 N 个成员，群里谁说话都只算这个群的 1 条，
// 不拆成 N 个 bot 各算一次，也不把群未读并进 bot 未读总数。

export function normalizeGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .filter((g) => g && typeof g.id === 'string')
    .map((g) => ({
      id: g.id,
      name: String(g.name || '未命名群组'),
      members: Array.isArray(g.members) ? g.members : [],
      memberCount: Array.isArray(g.members) ? g.members.length : 0,
      admin: g.admin ?? null,
      mode: g.mode ?? null,
      notice: typeof g.notice === 'string' ? g.notice : '',
      seq: typeof g.seq === 'number' ? g.seq : 0,
      preview: typeof g.preview === 'string' ? g.preview : '',
      unread: typeof g.unread === 'number' && g.unread > 0 ? g.unread : 0,
      hasUnread: Boolean(g.hasUnread),
    }))
    .sort((a, b) => b.seq - a.seq);
}

// 群未读总数：每个群最多算 1 条“有未读”，不按成员数放大
export function groupsUnreadCount(groups) {
  return groups.reduce((n, g) => n + (g.hasUnread || g.unread > 0 ? 1 : 0), 0);
}

// 未读文案：>9 一律 9+
export function unreadLabel(n) {
  if (!n || n <= 0) return '';
  return n > 9 ? '9+' : String(n);
}

// 群的未读数字与 bot 的分开展示：bot 用 unreadLabel，群只用圆点 + 「新消息」，数量取 min(9+)
export function groupUnreadLabel(g) {
  if (!g || (!g.hasUnread && !(g.unread > 0))) return '';
  return g.unread > 9 ? '9+' : String(g.unread || 1);
}
