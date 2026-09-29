import type { ButtonInput, ButtonRule, Command } from '@qqbot/sdk'
import { errorText } from '../actions.js'
import { guarded } from '../guard.js'
import { type PendingJoin, parseNotice, review } from '../review.js'
import { clearJoinFail } from '../store/fails.js'
import { loadGroup } from '../store/groups.js'

const G = ['group' as const]
const HANDLED = '这条申请处理过了或者格式不对'

/** 引用【进群申请】通知，发「批准」或「驳回 <理由>」（上游 set_approve） */
function approveCommand(approve: boolean, spec: { aliases: string[]; usage: string; description: string }): Command {
  return {
    ...spec,
    panelOnlyAdmin: true,
    scenes: G,
    handler: guarded('approve', async ({ ctx, session, argText, group }) => {
      const text = session.quote?.content
      if (!text) return '未引用任何【进群申请】'
      const notice = parseNotice(text)
      if (!notice) return undefined
      try {
        await review(ctx, group.id, notice.userId, approve, argText, notice.flag)
      } catch (err) {
        ctx.logger.error('处理进群申请失败', { error: errorText(err) })
        return HANDLED
      }
      if (approve) {
        await clearJoinFail(ctx.db, group.id, notice.userId)
        return `已同意${notice.nickname}进群`
      }
      return `已拒绝${notice.nickname}进群` + (argText ? `\n理由：${argText}` : '')
    }),
  }
}

function parsePending(data: string): PendingJoin | null {
  try {
    const d = JSON.parse(data) as Partial<PendingJoin>
    if (typeof d.g === 'string' && typeof d.m === 'string' && d.g && d.m) {
      return { g: d.g, m: d.m, f: typeof d.f === 'string' ? d.f : '', n: typeof d.n === 'string' ? d.n : '' }
    }
  } catch {
    // 不是我们发的按钮
  }
  return null
}

/**
 * 通知上的批准 / 驳回按钮。谁点得动由按钮的 permission 在 QQ 那边拦；
 * 回调不带群角色，这里只能再验一遍「超管」这一档
 */
async function onJoinButton({ ctx, session, buttonData }: ButtonInput, approve: boolean) {
  const pending = parsePending(buttonData)
  if (!pending) return HANDLED
  const group = await loadGroup(ctx.db, pending.g)
  if (group.config.perms.approve === '超管' && !session.isBotAdmin) return 4
  try {
    await review(ctx, pending.g, pending.m, approve, '', pending.f)
  } catch (err) {
    ctx.logger.error('处理进群申请失败', { error: errorText(err) })
    return HANDLED
  }
  if (approve) await clearJoinFail(ctx.db, pending.g, pending.m)
  return approve ? `已同意${pending.n}进群` : `已拒绝${pending.n}进群`
}

export const approveCommands: Record<string, Command> = {
  批准: approveCommand(true, { aliases: ['同意进群'], usage: '引用【进群申请】，发 /批准', description: '批准引用的进群申请' }),
  驳回: approveCommand(false, {
    aliases: ['拒绝进群', '不批准'],
    usage: '引用【进群申请】，发 /驳回 <理由>',
    description: '驳回引用的进群申请',
  }),
}

export const approveButtons: Record<string, ButtonRule> = {
  join_approve: { scenes: ['group', 'c2c'], handler: (input) => onJoinButton(input, true) },
  join_reject: { scenes: ['group', 'c2c'], handler: (input) => onJoinButton(input, false) },
}
