import type { Command, PluginContext } from '@qqbot/sdk'
import { errorText, muteMember, nameOf, sendToGroup, targetsOf, touchesBotAdmin } from '../actions.js'
import { banSeconds, intArg } from '../config.js'
import { guarded } from '../guard.js'
import { castVote, claimVote, createVote, expiredVotes, getVote, tally } from '../store/votes.js'

const G = ['group' as const]

/**
 * 结算一场到点的投票：先删行（删到才算自己结算），赞同多于反对就禁言，平票视为否决。
 * 上游用 asyncio.sleep 到点结算；这边由每分钟的定时任务或者到点后的下一次投票来结算
 */
async function settleExpired(ctx: PluginContext<unknown>, groupId: string): Promise<string | undefined> {
  const vote = await claimVote(ctx.db, groupId)
  if (!vote) return undefined
  const { agree, disagree } = tally(vote)
  if (agree <= disagree) return `投票时间到！禁言被否决，${vote.targetName}安全了`
  try {
    await muteMember(ctx, groupId, vote.target, vote.banTime)
    return `投票时间到！已禁言${vote.targetName}`
  } catch (err) {
    ctx.logger.error(`bot在群${groupId}权限不足，禁言失败`, { error: errorText(err) })
    return undefined
  }
}

/** 定时任务：到点的投票逐个结算，结果主动发到群里 */
export async function settleExpiredVotes(ctx: PluginContext<unknown>, now = Date.now()): Promise<void> {
  for (const vote of await expiredVotes(ctx.db, now)) {
    const text = await settleExpired(ctx, vote.groupId)
    if (text) await sendToGroup(ctx, vote.groupId, text)
  }
}

function voteCommand(agree: boolean): Command {
  return {
    description: agree ? '赞同当前的禁言投票' : '反对当前的禁言投票',
    scenes: G,
    handler: guarded('vote', async ({ ctx, session, group }) => {
      const vote = await getVote(ctx.db, group.id)
      if (!vote) return '当前没有进行中的禁言投票'
      if (vote.expireAt <= Date.now()) return (await settleExpired(ctx, group.id)) ?? '当前没有进行中的禁言投票'

      const updated = await castVote(ctx.db, group.id, session.userId, agree)
      if (!updated) return '当前没有进行中的禁言投票'
      const { agree: yes, disagree: no } = tally(updated)
      const { threshold, targetName } = updated

      // 提前达成赞同阈值 → 立即禁言
      if (yes >= threshold) {
        if (!(await claimVote(ctx.db, group.id))) return undefined
        try {
          await muteMember(ctx, group.id, updated.target, updated.banTime)
          return `投票通过！已禁言${targetName}`
        } catch (err) {
          ctx.logger.error(`bot在群${group.id}权限不足，禁言失败`, { error: errorText(err) })
          return undefined
        }
      }
      // 提前达成反对阈值 → 立即否决
      if (no >= threshold) {
        if (!(await claimVote(ctx.db, group.id))) return undefined
        return `禁言投票被否决，${targetName}安全了`
      }
      return `禁言【${targetName}】：\n赞同(${yes}/${threshold})\n反对(${no}/${threshold})`
    }),
  }
}

export const voteCommands: Record<string, Command> = {
  投票禁言: {
    usage: '/投票禁言 <秒数> @群友',
    description: '发起禁言投票',
    scenes: G,
    handler: guarded('vote', async ({ ctx, session, args, group }) => {
      const [target] = targetsOf(session)
      if (!target) return undefined
      if (touchesBotAdmin(ctx, [target])) return '我动不了超管'
      const cfg = group.config
      const banTime = banSeconds(cfg, intArg(args))
      const replies: string[] = []

      const existing = await getVote(ctx.db, group.id)
      if (existing) {
        if (existing.expireAt > Date.now()) return '群内已有正在进行的禁言投票'
        const settled = await settleExpired(ctx, group.id)
        if (settled) replies.push(settled)
      }

      const { ttl, threshold } = cfg.vote_ban
      const name = nameOf(target)
      const created = await createVote(ctx.db, {
        groupId: group.id,
        target: target.id,
        targetName: name,
        banTime,
        threshold,
        expireAt: Date.now() + ttl * 1000,
      })
      if (!created) return [...replies, '群内已有正在进行的禁言投票']
      replies.push(`已发起对 ${name} 的禁言投票(禁言${banTime}秒)，输入“赞同禁言/反对禁言”进行表态，${ttl}秒后结算`)
      return replies
    }),
  },
  赞同禁言: voteCommand(true),
  反对禁言: voteCommand(false),
}
