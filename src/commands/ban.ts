import type { Command } from '@qqbot/sdk'
import { muteMember, nameOf, targetsOf, touchesBotAdmin } from '../actions.js'
import { banSeconds, intArg } from '../config.js'
import { type GroupCommandInput, guarded } from '../guard.js'

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
    // 上游的「撤回 @某人 数量」要翻历史消息，官方接口没有历史消息，只保留引用撤回。
    // 群里的引用推送不带被引用消息的 id，框架拿 ref index 查它在内存里记的消息，2 分钟内、机器人收到过或发出的才查得到
    handler: guarded('delete_msg', async ({ ctx, session }) => {
      const quote = session.quote
      if (!quote?.messageId) {
        ctx.logger.info('群管撤回没拿到被引用消息的 id', quoteFields(session.raw))
        return quote ? '只能撤回 2 分钟内、机器人收到过的消息' : '未引用要撤回的消息'
      }
      const ok = await session.recall(quote.messageId)
      return ok ? undefined : '我无权撤回这条消息'
    }),
  },
}

/** 推送里和引用有关的字段（不带原文），用 wrangler tail 核对平台实际推了什么 */
function quoteFields(raw: unknown): Record<string, unknown> {
  const d = (raw && typeof raw === 'object' ? raw : {}) as {
    message_type?: unknown
    message_scene?: { ext?: unknown }
    message_reference?: unknown
    msg_elements?: unknown
  }
  const ext = Array.isArray(d.message_scene?.ext) ? d.message_scene.ext : []
  const first: unknown = Array.isArray(d.msg_elements) ? d.msg_elements[0] : undefined
  const element = first && typeof first === 'object' ? (first as Record<string, unknown>) : undefined
  return {
    messageType: d.message_type,
    // ext 里还有 auth_token 之类，只留引用索引
    ext: ext.filter((e): e is string => typeof e === 'string' && /^(ref_)?msg_idx=/.test(e)),
    messageReference: d.message_reference,
    element: element && { keys: Object.keys(element), msgIdx: element.msg_idx, id: element.id ?? element.message_id },
  }
}
