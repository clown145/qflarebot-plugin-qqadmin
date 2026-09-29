import { mentionedUsers, type OutgoingMessage, type PluginContext, qqAt, type Session } from '@qqbot/sdk'
import type { MentionedUser } from '@qqbot/sdk'

/** 被 @ 的群友（不含机器人），按出现先后 */
export function targetsOf(session: Session): MentionedUser[] {
  return mentionedUsers(session)
}

/**
 * 群友怎么称呼：官方接口查不了群名片，消息里带了名字就用，没有就写成 <@openid>，群里会显示成对方的名字
 * （上游是查群名片、再退到 QQ 号）
 */
export function nameOf(user: { id: string; username?: string }): string {
  return user.username || qqAt(user.id)
}

/** 被 @ 的人里有没有 Bot 管理员：上游「我动不了超管」 */
export function touchesBotAdmin(ctx: PluginContext<unknown>, users: readonly { id: string }[]): boolean {
  return users.some((u) => ctx.botAdmins.includes(u.id))
}

/** 禁言；秒数为 0 时解除。已经在禁言中的人 add 不行就改用 update 改时长 */
export async function muteMember(ctx: PluginContext<unknown>, groupId: string, userId: string, seconds: number): Promise<void> {
  if (seconds <= 0) {
    await ctx.api.group.mute(groupId, [{ op: 'del', memberOpenid: userId }])
    return
  }
  const expireAt = new Date(Date.now() + seconds * 1000)
  try {
    await ctx.api.group.mute(groupId, [{ op: 'add', memberOpenid: userId, expireAt }])
  } catch {
    await ctx.api.group.mute(groupId, [{ op: 'update', memberOpenid: userId, expireAt }])
  }
}

/**
 * 往群里主动发消息（入群申请、欢迎、退群通报这些事件不能被动回复）。
 * 群主没开「主动消息」时发不出去，只记日志
 */
export async function sendToGroup(ctx: PluginContext<unknown>, groupId: string, message: OutgoingMessage): Promise<boolean> {
  const r = await ctx.api.sendMessage({ scene: 'group', id: groupId }, message)
  if (!r.ok) ctx.logger.warn('群管往群里主动发消息失败，群主可能没开「主动消息」', { groupId, error: r.error })
  return r.ok
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
