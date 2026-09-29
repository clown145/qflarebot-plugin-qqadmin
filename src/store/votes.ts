import type { ScopedDB } from '@qqbot/sdk'

/** 进行中的禁言投票；每群最多一场 */
export interface Vote {
  groupId: string
  target: string
  targetName: string
  banTime: number
  threshold: number
  /** 毫秒时间戳 */
  expireAt: number
  /** 投票人 → 赞同 */
  votes: Record<string, boolean>
}

interface VoteRow {
  group_id: string
  target: string
  target_name: string
  ban_time: number
  threshold: number
  expire_at: number
  votes: string
}

function toVote(r: VoteRow): Vote {
  let votes: Record<string, boolean> = {}
  try {
    votes = JSON.parse(r.votes) as Record<string, boolean>
  } catch {
    // 坏数据当没人投过
  }
  return {
    groupId: r.group_id,
    target: r.target,
    targetName: r.target_name,
    banTime: r.ban_time,
    threshold: r.threshold,
    expireAt: r.expire_at,
    votes,
  }
}

export function tally(vote: Vote): { agree: number; disagree: number } {
  const all = Object.values(vote.votes)
  const agree = all.filter(Boolean).length
  return { agree, disagree: all.length - agree }
}

export async function getVote(db: ScopedDB, groupId: string): Promise<Vote | null> {
  const row = await db.first<VoteRow>('SELECT * FROM {votes} WHERE group_id = ?', groupId)
  return row ? toVote(row) : null
}

/** 发起投票；本群已有一场时不写，返回 false */
export async function createVote(db: ScopedDB, vote: Omit<Vote, 'votes'>): Promise<boolean> {
  const { changes } = await db.run(
    `INSERT INTO {votes} (group_id, target, target_name, ban_time, threshold, expire_at, votes)
     VALUES (?, ?, ?, ?, ?, ?, '{}') ON CONFLICT (group_id) DO NOTHING`,
    vote.groupId,
    vote.target,
    vote.targetName,
    vote.banTime,
    vote.threshold,
    vote.expireAt,
  )
  return changes > 0
}

/** 记一票（同一人再投改成新的立场），返回投完之后的整场；投票已经没了返回 null */
export async function castVote(db: ScopedDB, groupId: string, voter: string, agree: boolean): Promise<Vote | null> {
  // openid 只有字母数字，直接拼进 JSON 路径的引号里
  const row = await db.first<VoteRow>(
    `UPDATE {votes} SET votes = json_set(votes, '$."' || ? || '"', json(?)) WHERE group_id = ? RETURNING *`,
    voter.replace(/[^0-9A-Za-z_-]/g, ''),
    agree ? 'true' : 'false',
    groupId,
  )
  return row ? toVote(row) : null
}

/** 结算前先删：删到的那一方负责结算，定时任务和投票同时到也只结算一次 */
export async function claimVote(db: ScopedDB, groupId: string): Promise<Vote | null> {
  const row = await db.first<VoteRow>('DELETE FROM {votes} WHERE group_id = ? RETURNING *', groupId)
  return row ? toVote(row) : null
}

export async function expiredVotes(db: ScopedDB, now: number): Promise<Vote[]> {
  const rows = await db.all<VoteRow>('SELECT * FROM {votes} WHERE expire_at <= ?', now)
  return rows.map(toVote)
}
