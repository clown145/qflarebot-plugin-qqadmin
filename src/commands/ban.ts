import type { Command } from '@qqbot/sdk'
import { muteMember, nameOf, targetsOf, touchesBotAdmin } from '../actions.js'
import { banSeconds, intArg } from '../config.js'
import { type GroupCommandInput, guarded } from '../guard.js'
import { recallQuoted } from '../recall.js'

const G = ['group' as const]

/**
 * 禁言 / 解禁被 @ 的人，一人一行结果。
 * 上游的命令处理器把结果算出来却没发出去（禁言、解禁都没有回复），这边照原文回。
 */
async function banTargets({ ctx, session, group }: GroupCommandInput, seconds: number): Promise<string> {
  const targets = targetsOf(session)
  if (!targets.length) return '未指定要禁言的用户'
  if (touchesBotAdmin(ctx, targets)) return '我动不了超管'
  const results: string[] = []
  for (const t of targets) {
    try {
      await muteMember(ctx, group.id, t.id, seconds)
      // 上游解禁也走这里，会回「已被禁言0秒」
      results.push(seconds > 0 ? `用户[${nameOf(t)}]已被禁言${seconds}秒` : `用户[${nameOf(t)}]已解除禁言`)
    } catch (err) {
      ctx.logger.warn('群管禁言失败', { groupId: group.id, error: err instanceof Error ? err.message : String(err) })
      results.push(`用户[${nameOf(t)}]禁言失败`)
    }
  }
  return results.join('\n')
}

export const banCommands: Record<string, Command> = {
  禁言: {
    usage: '/禁言 <秒数> @群友',
    description: '禁言群友，不写秒数随机',
    panelOnlyAdmin: true,
    scenes: G,
    // 上游这里的权限项写成了改名的 set_group_card，配置里的「禁言」一项不起作用
    handler: guarded('set_group_ban', (input) => banTargets(input, banSeconds(input.group.config, intArg(input.args)))),
  },

  解禁: {
    usage: '/解禁 @群友',
    description: '解除群友的禁言',
    panelOnlyAdmin: true,
    scenes: G,
    handler: guarded('cancel_group_ban', (input) => banTargets(input, 0)),
  },

  撤回: {
    usage: '引用一条消息，发 /撤回',
    description: '撤回引用的那条消息',
    scenes: G,
    // 上游的「撤回 @某人 数量」要翻历史消息，官方接口没有历史消息，只保留引用撤回
    handler: guarded('delete_msg', recallQuoted),
  },
}
