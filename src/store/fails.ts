import type { ScopedDB } from '@qqbot/sdk'

/** 记一次没命中关键词的入群申请，返回累计次数 */
export async function addJoinFail(db: ScopedDB, groupId: string, userId: string, now = Date.now()): Promise<number> {
  const row = await db.first<{ count: number }>(
    `INSERT INTO {join_fails} (group_id, user_id, count, updated_at) VALUES (?, ?, 1, ?)
     ON CONFLICT (group_id, user_id) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
     RETURNING count`,
    groupId,
    userId,
    now,
  )
  return row?.count ?? 1
}

/** 通过或拉黑之后就不用再记了 */
export async function clearJoinFail(db: ScopedDB, groupId: string, userId: string): Promise<void> {
  await db.run('DELETE FROM {join_fails} WHERE group_id = ? AND user_id = ?', groupId, userId)
}

/** 清掉很久没再申请的记录，每行一辈子只删一次 */
export async function pruneJoinFails(db: ScopedDB, before: number): Promise<number> {
  const { changes } = await db.run('DELETE FROM {join_fails} WHERE updated_at < ?', before)
  return changes
}
