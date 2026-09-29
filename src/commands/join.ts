import type { Command, Session } from '@qqbot/sdk'
import { targetsOf } from '../actions.js'
import { intArg, onOff, parseBool, pyList } from '../config.js'
import { type GroupConfig, MAX_BAN_SECONDS, type PermKey } from '../fields.js'
import { guarded } from '../guard.js'
import { updateGroup } from '../store/groups.js'
import { editReport } from './banwords.js'

const G = ['group' as const]

type BoolKey = { [K in keyof GroupConfig]: GroupConfig[K] extends boolean ? K : never }[keyof GroupConfig]

/** 开/关 类的设置；不带参数就是查看（上游不带参数时会被当成「关」写进去） */
function toggle(perm: PermKey, field: BoolKey, spec: { usage: string; description: string; set: string; view: string }): Command {
  return {
    usage: spec.usage,
    description: spec.description,
    panelOnlyAdmin: true,
    scenes: G,
    handler: guarded(perm, async ({ ctx, args, group }) => {
      const mode = parseBool(args[0])
      if (mode === undefined) return `${spec.view}${onOff(group.config[field])}`
      await updateGroup(ctx.db, group, (c) => void (c[field] = mode))
      return `${spec.set}${onOff(mode)}`
    }),
  }
}

/** 进群白词 / 黑词：带参数就整表设置，不带就查看 */
function words(field: 'join_accept_words' | 'join_reject_words', name: string, description: string): Command {
  return {
    usage: `/${name} <关键词...>`,
    description,
    panelOnlyAdmin: true,
    scenes: G,
    handler: guarded('join', async ({ ctx, args, group }) => {
      if (!args.length) return `本群${name}：${pyList(group.config[field])}`
      await updateGroup(ctx.db, group, (c) => void (c[field] = [...args]))
      return `本群${name}已设为：${pyList(args)}`
    }),
  }
}

const OPENID = /^([+-]?)([0-9A-Za-z_-]{16,})$/

/**
 * 进群黑名单的参数：上游写 QQ 号，这边没有 QQ 号，改成 @群友 或直接写 openid，前面带 + - 表示增删。
 * 返回 [符号, openid]，符号为空表示没带
 */
export function blockTokens(session: Session, args: readonly string[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const raw = (session.raw as { content?: unknown } | null)?.content
  const content = typeof raw === 'string' ? raw : ''
  for (const u of targetsOf(session)) {
    const sign = new RegExp(`([+-])\\s*<@!?${u.id}>`).exec(content)?.[1] ?? ''
    out.push([sign, u.id])
  }
  for (const a of args) {
    const m = OPENID.exec(a)
    if (m && !out.some(([, id]) => id === m[2])) out.push([m[1]!, m[2]!])
  }
  return out
}

export const joinCommands: Record<string, Command> = {
  进群审核: toggle('join', 'join_switch', {
    usage: '/进群审核 开/关',
    description: '进群审核总开关',
    set: '本群进群审核：',
    view: '本群进群审核：',
  }),
  进群白词: words('join_accept_words', '进群白词', '命中就自动批准进群'),
  进群黑词: words('join_reject_words', '进群黑词', '命中就自动拒绝进群'),
  未命中驳回: toggle('join', 'join_no_match_reject', {
    usage: '/未命中驳回 开/关',
    description: '没命中白词就驳回',
    set: '本群未命中白词驳回已设为：',
    view: '本群未命中白词驳回：',
  }),

  进群次数: {
    usage: '/进群次数 <次数>，0 表示不限制',
    description: '没命中几次后拉黑',
    panelOnlyAdmin: true,
    scenes: G,
    handler: guarded('join', async ({ ctx, args, group }) => {
      const time = intArg(args)
      if (time === undefined) return `本群进群可尝试次数：${group.config.join_max_time} 次`
      const t = Math.min(Math.max(time, 0), 100)
      await updateGroup(ctx.db, group, (c) => void (c.join_max_time = t))
      return t > 0 ? `本群进群次数已限制为：${t} 次` : '已解除本群的进群次数限制'
    }),
  },

  进群黑名单: {
    usage: '/进群黑名单 +@群友 -@群友（也可以写 openid，不带 +- 就整表覆写）',
    description: '查看或修改进群黑名单',
    panelOnlyAdmin: true,
    scenes: G,
    handler: guarded('join', async ({ ctx, session, args, group }) => {
      const tokens = blockTokens(session, args)
      if (!tokens.length) return `本群进群黑名单：${pyList(group.config.block_ids)}`
      if (tokens.every(([sign]) => !sign)) {
        const ids = tokens.map(([, id]) => id)
        await updateGroup(ctx.db, group, (c) => void (c.block_ids = ids))
        return `黑名单已覆写为：${ids.join(' ')}`
      }
      const set = new Set(group.config.block_ids)
      const added: string[] = []
      const removed: string[] = []
      for (const [sign, id] of tokens) {
        if (sign === '+' && !set.has(id)) {
          set.add(id)
          added.push(id)
        } else if (sign === '-' && set.has(id)) {
          set.delete(id)
          removed.push(id)
        }
      }
      if (added.length || removed.length) await updateGroup(ctx.db, group, (c) => void (c.block_ids = [...set]))
      return editReport('本群进群黑名单', added, removed)
    }),
  },

  进群禁言: {
    usage: '/进群禁言 <秒数>，0 表示不启用',
    description: '新成员进群自动禁言',
    panelOnlyAdmin: true,
    scenes: G,
    handler: guarded('welcome', async ({ ctx, args, group }) => {
      const time = intArg(args)
      if (time === undefined) return `本群进群禁言设置：${group.config.join_ban_time} 秒`
      const t = Math.min(Math.max(time, 0), MAX_BAN_SECONDS)
      await updateGroup(ctx.db, group, (c) => void (c.join_ban_time = t))
      return t > 0 ? `本群进群禁言已设为：${t} 秒` : '已关闭本群进群禁言'
    }),
  },

  进群欢迎: {
    usage: '/进群欢迎 <欢迎语>，可以用 {nickname}',
    description: '设置或查看进群欢迎语',
    panelOnlyAdmin: true,
    scenes: G,
    handler: guarded('welcome', async ({ ctx, argText, group }) => {
      if (!argText) return `本群进群欢迎语：\n${group.config.join_welcome || '（未设置）'}`
      await updateGroup(ctx.db, group, (c) => void (c.join_welcome = argText))
      return `本群进群欢迎语已设为：\n${argText}`
    }),
  },

  退群通知: toggle('leave', 'leave_notify', {
    usage: '/退群通知 开/关',
    description: '有人主动退群时通报',
    set: '本群退群通知已设为：',
    view: '本群退群通知：',
  }),
  退群拉黑: toggle('leave', 'leave_block', {
    usage: '/退群拉黑 开/关',
    description: '主动退群的人拉黑',
    set: '本群退群拉黑已设为：',
    view: '本群退群拉黑：',
  }),
}
