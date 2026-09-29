import type { ScopedDB } from '@qqbot/sdk'

/**
 * 三张表，都只有主键、没有二级索引（WITHOUT ROWID），写一行就只算一行：
 *
 * - {groups}：每群一行，外加 `__default__` 这一行（上游的「默认群」）。群第一次出现时补一行「跟随默认」，
 *   这辈子只写这一次；之后只有管理员改设置才写。管理页面的群列表就是这张表
 * - {votes}：进行中的禁言投票，每群最多一行，结算时删掉
 * - {join_fails}：入群申请没命中关键词的次数（上游放内存里，Workers 的内存留不住）
 *
 * 每条群消息都要读设置，读的结果在内存里缓存一分钟，平时每条消息 0 次写入、多数时候 0 次查询。
 */
export async function initSchema(db: ScopedDB): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS {groups} (
      group_id TEXT PRIMARY KEY,
      follow INTEGER NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS {votes} (
      group_id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      target_name TEXT NOT NULL,
      ban_time INTEGER NOT NULL,
      threshold INTEGER NOT NULL,
      expire_at INTEGER NOT NULL,
      votes TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS {join_fails} (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (group_id, user_id)
    ) WITHOUT ROWID;
  `)
}
