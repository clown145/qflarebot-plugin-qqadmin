import { type EventInput, qqAt } from '@qqbot/sdk'
import { errorText, muteMember, sendToGroup } from './actions.js'
import { loadGroup, removeGroup, updateGroup } from './store/groups.js'
import { claimVote } from './store/votes.js'

/** 新成员进群：欢迎、禁言（上游 group_increase 分支）。欢迎语要群主开「主动消息」才发得出去 */
export async function onMemberAdded({ session, ctx }: EventInput): Promise<void> {
  const groupId = session.targetId
  const userId = session.userId
  if (!groupId || !userId) return
  const { config } = await loadGroup(ctx.db, groupId)
  if (config.join_welcome) {
    const nickname = session.userName || qqAt(userId)
    await sendToGroup(ctx, groupId, config.join_welcome.replaceAll('{nickname}', nickname))
  }
  if (config.join_ban_time > 0) {
    try {
      await muteMember(ctx, groupId, userId, config.join_ban_time)
    } catch (err) {
      ctx.logger.warn('群管进群禁言失败', { groupId, error: errorText(err) })
    }
  }
}

/**
 * 主动退群：通报、拉黑（上游 group_decrease 的 leave 分支）。
 * 被踢的（操作人不是本人）不算。上游把「退群拉黑」写在「退群通知」开着的分支里，只开拉黑不生效；这边两个各管各的
 */
export async function onMemberRemoved({ session, ctx }: EventInput): Promise<void> {
  const groupId = session.targetId
  const userId = session.userId
  if (!groupId || !userId) return
  const op = (session.raw as { op_member_openid?: unknown } | null)?.op_member_openid
  if (typeof op === 'string' && op && op !== userId) return

  const group = await loadGroup(ctx.db, groupId)
  const { leave_notify, leave_block, block_ids } = group.config
  if (!leave_notify && !leave_block) return
  let msg = `${session.userName || '群友'}(${userId}) 主动退群了`
  if (leave_block) {
    if (!block_ids.includes(userId)) await updateGroup(ctx.db, group, (c) => void c.block_ids.push(userId))
    msg += '，已拉黑'
  }
  if (leave_notify) await sendToGroup(ctx, groupId, msg)
}

/** 机器人进群：记下这个群，管理页面里就能看到它 */
export async function onRobotAdded({ session, ctx }: EventInput): Promise<void> {
  if (session.targetId) await loadGroup(ctx.db, session.targetId)
}

/** 机器人被移出群：清掉这个群的配置和投票（上游是群人数为 0 时自动清理） */
export async function onRobotRemoved({ session, ctx }: EventInput): Promise<void> {
  if (!session.targetId) return
  await removeGroup(ctx.db, session.targetId)
  await claimVote(ctx.db, session.targetId)
}
