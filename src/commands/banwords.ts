import type { Command } from '@qqbot/sdk'
import { intArg, onOff, parseBool, pyList } from '../config.js'
import { MAX_BAN_SECONDS } from '../fields.js'
import { guarded } from '../guard.js'
import { updateGroup } from '../store/groups.js'

const G = ['group' as const]
const clampSeconds = (n: number) => Math.min(Math.max(n, 0), MAX_BAN_SECONDS)

/** 「+词 -词」增删；全都不带 +- 时整表覆写（上游 handle_ban_words / handle_block_ids 的规则） */
export function applyWordEdits(current: readonly string[], tokens: readonly string[]): { list: string[]; added: string[]; removed: string[]; overwrite: boolean } {
  if (tokens.every((t) => !t.startsWith('+') && !t.startsWith('-'))) {
    return { list: [...tokens], added: [], removed: [], overwrite: true }
  }
  const set = new Set(current)
  const added: string[] = []
  const removed: string[] = []
  for (const t of tokens) {
    const w = t.slice(1)
    if (!w) continue
    if (t.startsWith('+') && !set.has(w)) {
      set.add(w)
      added.push(w)
    } else if (t.startsWith('-') && set.has(w)) {
      set.delete(w)
      removed.push(w)
    }
  }
  return { list: [...set], added, removed, overwrite: false }
}

export function editReport(title: string, added: readonly string[], removed: readonly string[]): string {
  const lines = [title]
  if (added.length) lines.push(`新增：${added.join('、')}`)
  if (removed.length) lines.push(`移除：${removed.join('、')}`)
  if (!added.length && !removed.length) lines.push('无变动')
  return lines.join('\n')
}

export const banwordCommands: Record<string, Command> = {
  禁词禁言: {
    usage: '/禁词禁言 <秒数>',
    description: '触发禁词时的禁言秒数',
    panelOnlyAdmin: true,
    scenes: G,
    handler: guarded('word_ban', async ({ ctx, args, group }) => {
      const time = intArg(args)
      if (time === undefined) return `本群禁词禁言时长：${group.config.word_ban_time} 秒`
      const t = clampSeconds(time)
      await updateGroup(ctx.db, group, (c) => void (c.word_ban_time = t))
      return t > 0 ? `本群禁词禁言时长已设为：${t} 秒` : '本群禁词禁言已关闭'
    }),
  },

  设置禁词: {
    aliases: ['禁词', '违禁词'],
    usage: '/设置禁词 词1 词2（+词 -词 增删，不带参数查看）',
    description: '设置或查看本群违禁词',
    panelOnlyAdmin: true,
    scenes: G,
    handler: guarded('word_ban', async ({ ctx, args, group }) => {
      if (!args.length) return `本群违禁词：${pyList(group.config.custom_ban_words)}`
      const r = applyWordEdits(group.config.custom_ban_words, args)
      await updateGroup(ctx.db, group, (c) => void (c.custom_ban_words = r.list))
      return r.overwrite ? `本群违禁词已覆写为：${args.join(' ')}` : editReport('本群违禁词', r.added, r.removed)
    }),
  },

  内置禁词: {
    usage: '/内置禁词 开/关',
    description: '开关内置敏感词库',
    panelOnlyAdmin: true,
    scenes: G,
    handler: guarded('word_ban', async ({ ctx, args, group }) => {
      const mode = parseBool(args[0])
      if (mode === undefined) return `本群内置禁词：${onOff(group.config.builtin_ban)}`
      await updateGroup(ctx.db, group, (c) => void (c.builtin_ban = mode))
      return `本群内置禁词：${onOff(mode)}`
    }),
  },

  刷屏禁言: {
    usage: '/刷屏禁言 <秒数>，0 表示关闭',
    description: '刷屏时的禁言秒数',
    panelOnlyAdmin: true,
    scenes: G,
    // 上游这条命令读写的都是禁词禁言的 word_ban_time，刷屏检测读的 spamming_ban_time 永远改不了
    handler: guarded('spamming', async ({ ctx, args, group }) => {
      const time = intArg(args)
      if (time === undefined) return `本群刷屏禁言时长：${group.config.spamming_ban_time} 秒`
      const t = clampSeconds(time)
      await updateGroup(ctx.db, group, (c) => void (c.spamming_ban_time = t))
      return t > 0 ? `本群刷屏禁言时长已设为：${t} 秒` : '本群刷屏禁言已关闭'
    }),
  },
}
