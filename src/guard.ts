import type { Awaitable, ButtonPermission, CommandHandler, CommandInput, HandlerResult, Session } from '@qqbot/sdk'
import type { GroupConfig, PermKey, PermName } from './fields.js'
import { type GroupState, loadGroup } from './store/groups.js'

/** 数字越小权限越高（上游 PermLevel，去掉了要看群等级的「高等级成员」） */
const LEVEL: Record<PermName, number> = { 超管: 0, 群主: 1, 管理员: 2, 成员: 3 }

export function userLevel(session: Pick<Session, 'isBotAdmin' | 'memberRole'>): number {
  if (session.isBotAdmin === true) return 0
  switch (session.memberRole) {
    case 'owner':
      return 1
    case 'admin':
      return 2
    case 'member':
      return 3
    default:
      return 4
  }
}

/** 权限不够时的回复（上游原文「你没X权限」），够就是 null */
export function permError(session: Pick<Session, 'isBotAdmin' | 'memberRole'>, cfg: GroupConfig, key: PermKey): string | null {
  const required = cfg.perms[key]
  return userLevel(session) > LEVEL[required] ? `你没${required}权限` : null
}

/**
 * 按钮谁点得动：超管用指定用户（Bot 管理员名单），群主和管理员都是平台的「仅管理员」（平台没有仅群主），成员所有人。
 * 回调不带群角色，只有超管这一档在处理器里还能再验一遍
 */
export function buttonPermission(cfg: GroupConfig, key: PermKey, botAdmins: readonly string[], inGroup: boolean): ButtonPermission {
  const required = cfg.perms[key]
  if (required === '超管') return { type: 0, specify_user_ids: [...botAdmins] }
  if (required === '成员' || !inGroup) return { type: 2 }
  return { type: 1 }
}

export type GroupCommandInput = CommandInput & { group: GroupState }

/** 群聊命令：先取本群配置，再按配置里的权限判断，不够就回「你没X权限」 */
export function guarded(key: PermKey, handler: (input: GroupCommandInput) => Awaitable<HandlerResult>): CommandHandler {
  return async (input) => {
    const group = await loadGroup(input.ctx.db, input.session.targetId)
    const denied = permError(input.session, group.config, key)
    if (denied) return denied
    return handler({ ...input, group })
  }
}
