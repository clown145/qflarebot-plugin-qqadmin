import { button, type EventInput, type JoinRequest, keyboard, type Keyboard, type PluginContext } from '@qqbot/sdk'
import { errorText, sendToGroup } from './actions.js'
import type { GroupConfig } from './fields.js'
import { buttonPermission } from './guard.js'
import { addJoinFail, clearJoinFail } from './store/fails.js'
import { type GroupState, loadGroup, updateGroup } from './store/groups.js'

/** 按钮里带的申请信息 */
export interface PendingJoin {
  g: string
  m: string
  f: string
  n: string
}

interface JoinInfo {
  joinRequestId: string
  nickname: string
  /** 通知里显示的问题和答案（上游 OneBot 给的 comment 就是「问题：…\n答案：…」） */
  comment: string
  /** 拿来匹配关键词的只有答案部分 */
  answer: string
}

type RawJoin = Partial<JoinRequest> & { username?: string }

/** 推送里没带验证信息时，去入群申请列表里找这一条（机器人是管理员就能查） */
async function joinInfo(ctx: PluginContext<unknown>, groupId: string, userId: string, raw: RawJoin): Promise<JoinInfo> {
  let req: RawJoin = raw
  if (!raw.verify_info) {
    try {
      const list = await ctx.api.group.joinRequests(groupId)
      req = list.find((r) => (raw.join_request_id && r.join_request_id === raw.join_request_id) || r.member_openid === userId) ?? raw
    } catch (err) {
      ctx.logger.warn('群管拉取入群申请失败', { groupId, error: errorText(err) })
    }
  }
  const qa = req.verify_info?.review_qa_list ?? []
  const message = req.verify_info?.verify_message ?? ''
  return {
    joinRequestId: String(raw.join_request_id ?? req.join_request_id ?? ''),
    nickname: raw.username || req.username || '未知昵称',
    comment: qa.length ? qa.map((q) => `问题：${q.question}\n答案：${q.answer}`).join('\n') : message,
    answer: qa.length ? qa.map((q) => q.answer).join('\n') : message,
  }
}

async function addBlock(ctx: PluginContext<unknown>, group: GroupState, userId: string): Promise<void> {
  if (group.config.block_ids.includes(userId)) return
  await updateGroup(ctx.db, group, (c) => void c.block_ids.push(userId))
}

/** 判断是否让该用户入群，返回原因；null 表示转人工（上游 should_approve，去掉了拿不到的 QQ 等级） */
export async function shouldApprove(
  ctx: PluginContext<unknown>,
  group: GroupState,
  userId: string,
  answer: string,
): Promise<[boolean | null, string]> {
  const cfg: GroupConfig = group.config
  // 1.黑名单用户
  if (cfg.block_ids.includes(userId)) return [false, '黑名单用户']
  if (answer) {
    const lower = answer.toLowerCase()
    // 2.命中进群黑词
    if (cfg.join_reject_words.some((w) => lower.includes(w.toLowerCase()))) {
      if (cfg.reject_word_block) {
        await addBlock(ctx, group, userId)
        return [false, '命中进群黑词，已拉黑']
      }
      return [false, '命中进群黑词']
    }
    // 3.命中进群白词
    if (cfg.join_accept_words.some((w) => lower.includes(w.toLowerCase()))) return [true, '命中进群白词']
  }
  // 4.最大失败次数
  if (cfg.join_max_time > 0) {
    const count = await addJoinFail(ctx.db, group.id, userId)
    if (count >= cfg.join_max_time) {
      await addBlock(ctx, group, userId)
      await clearJoinFail(ctx.db, group.id, userId)
      return [false, `进群尝试次数已达上限(${cfg.join_max_time}次)，已拉黑`]
    }
  }
  // 5.未命中白词时, 自动驳回
  if (cfg.join_no_match_reject) return [false, '未命中进群关键词']
  // 6.未命中进群关键词, 人工审核
  return [null, '人工审核']
}

export async function review(
  ctx: PluginContext<unknown>,
  groupId: string,
  userId: string,
  approve: boolean,
  reason: string,
  joinRequestId: string,
): Promise<void> {
  await ctx.api.group.reviewJoinRequest(
    groupId,
    userId,
    approve ? { approve: true } : { approve: false, reason },
    joinRequestId || undefined,
  )
}

/** 从引用的【进群申请】通知里取出申请人（上游按行号取昵称和 flag，这边按标签取） */
export function parseNotice(text: string): { nickname: string; userId: string; flag: string } | null {
  if (!text.includes('【进群申请】')) return null
  const field = (label: string) => new RegExp(`^${label}：(.*)$`, 'm').exec(text)?.[1]?.trim() ?? ''
  const userId = field('openid')
  if (!userId) return null
  return { nickname: field('昵称'), userId, flag: field('flag') }
}

export function joinKeyboard(cfg: GroupConfig, botAdmins: readonly string[], pending: PendingJoin, inGroup: boolean): Keyboard {
  const permission = buttonPermission(cfg, 'approve', botAdmins, inGroup)
  const data = JSON.stringify(pending)
  return keyboard([
    [
      button.callback('批准', data, { id: 'join_approve', style: 1, permission, groupId: 'join' }),
      button.callback('驳回', data, { id: 'join_reject', style: 0, permission, groupId: 'join' }),
    ],
  ])
}

/** 发通知：开了「仅通知 bot 管理员」就私聊每个管理员，否则发到群里；带按钮发不出去时退回纯文字 */
async function deliverNotice(ctx: PluginContext<unknown>, group: GroupState, notice: string, pending: PendingJoin | null): Promise<void> {
  const cfg = group.config
  if (cfg.admin_audit) {
    if (!ctx.botAdmins.length) ctx.logger.warn('群管开了「进群事件仅通知bot管理员」，但面板里没有 Bot 管理员')
    for (const admin of ctx.botAdmins) {
      const kb = pending ? joinKeyboard(cfg, ctx.botAdmins, pending, false) : undefined
      const target = { scene: 'c2c' as const, id: admin }
      let r = await ctx.api.sendMessage(target, kb ? { text: notice, keyboard: kb } : notice)
      if (!r.ok && kb) r = await ctx.api.sendMessage(target, notice)
      if (!r.ok) ctx.logger.error('无法发送消息给bot管理员', { error: r.error })
    }
    return
  }
  const kb = pending ? joinKeyboard(cfg, ctx.botAdmins, pending, true) : undefined
  if (kb && (await ctx.api.sendMessage({ scene: 'group', id: group.id }, { text: notice, keyboard: kb })).ok) return
  await sendToGroup(ctx, group.id, notice)
}

/** 入群申请事件（上游 event_monitoring 的进群申请分支） */
export async function onJoinRequest({ session, ctx }: EventInput): Promise<void> {
  const groupId = session.targetId
  const userId = session.userId
  if (!groupId || !userId) return
  const group = await loadGroup(ctx.db, groupId)
  // 进群审核总开关
  if (!group.config.join_switch) return

  const info = await joinInfo(ctx, groupId, userId, (session.raw ?? {}) as RawJoin)
  const [approve, reason] = await shouldApprove(ctx, group, userId, info.answer)
  if (approve === true) await clearJoinFail(ctx.db, groupId, userId)

  let approveMsg = ''
  if (approve !== null) {
    try {
      await review(ctx, groupId, userId, approve, approve ? '' : reason, info.joinRequestId)
    } catch (err) {
      ctx.logger.warn('群管自动审批入群申请失败', { groupId, error: errorText(err) })
      return
    }
    if (!approve && reason === '黑名单用户') return
    approveMsg = `自动${approve ? '批准' : '驳回'}：${reason}`
  }

  const tip = approveMsg ? '' : '批准/驳回：'
  let notice = `【进群申请】${tip}\n昵称：${info.nickname}\nopenid：${userId}\nflag：${info.joinRequestId}`
  if (info.comment) notice += `\n${info.comment}`
  if (approveMsg) notice += `\n${approveMsg}`
  const pending = approve === null ? { g: groupId, m: userId, f: info.joinRequestId, n: info.nickname.slice(0, 20) } : null
  await deliverNotice(ctx, group, notice, pending)
}
