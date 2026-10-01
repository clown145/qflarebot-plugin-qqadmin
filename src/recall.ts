import type { PluginContext } from '@qqbot/sdk'
import { errorText } from './actions.js'
import type { GroupCommandInput } from './guard.js'
import { diagnoseMiss, quoteFields } from './recallDiag.js'

/** 撤回接口的错误码，取自另一个官方机器人群管插件 astrbot_plugin_qq_group_manager 的整理 */
const RECALL_EXPIRED = 40064004
const RECALL_FORBIDDEN = 40062003

/**
 * 引用撤回。群里的引用推送不带被引用消息的 id，框架拿引用索引查它在内存里记的消息，
 * 2 分钟内、机器人收到过或发出的才查得到
 */
export async function recallQuoted({ ctx, session }: GroupCommandInput): Promise<string | undefined> {
  const quote = session.quote
  if (!quote) {
    ctx.logger.info('群管撤回没引用消息', quoteFields(session.raw))
    return '未引用要撤回的消息'
  }
  if (!quote.messageId) {
    ctx.logger.warn('群管撤回没拿到被引用消息的 id', await diagnoseMiss(ctx, session))
    return '没找到这条消息，撤回不了：只能撤回 2 分钟内、机器人收到过的消息（群主没开「获取群内全部消息」时，群友不 @ 机器人的消息收不到）'
  }
  return recallById(ctx, session.targetId, quote.messageId)
}

/** 直接调撤回接口：session.recall 只说成没成，撤不了的原因要读平台的回应 */
async function recallById(ctx: PluginContext<unknown>, groupId: string, messageId: string): Promise<string | undefined> {
  let status: number
  let data: unknown
  try {
    ;({ status, data } = await ctx.api.raw('DELETE', `/v2/groups/${groupId}/messages/${messageId}`))
  } catch (err) {
    ctx.logger.warn('群管撤回失败', { groupId, error: errorText(err) })
    return `撤回失败：${errorText(err)}`
  }
  if (status >= 200 && status < 300) return undefined

  const body = (data && typeof data === 'object' ? data : {}) as { code?: unknown; err_code?: unknown; message?: unknown }
  const code = Number(body.code ?? body.err_code) || undefined
  const message = typeof body.message === 'string' ? body.message : ''
  ctx.logger.warn('群管撤回失败', { groupId, status, code, message })
  if (code === RECALL_EXPIRED || message.includes('撤回时限')) return '消息发送超过 2 分钟，无法撤回'
  // 上游所有失败都回这一句；官方机器人当管理员也撤不了群主和其他管理员的消息，补上原因
  if (code === RECALL_FORBIDDEN || status === 403) return '我无权撤回这条消息（机器人要是群管理员，且撤不了群主和其他管理员的消息）'
  return `撤回失败：${message || `HTTP ${status}`}${code ? `（错误码 ${code}）` : ''}`
}
