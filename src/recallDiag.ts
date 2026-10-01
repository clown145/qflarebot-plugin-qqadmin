import type { PluginContext, Session } from '@qqbot/sdk'
import { errorText } from './actions.js'

/**
 * 引用撤回查不到消息 id 时的诊断信息，只在查不到时打一行日志。
 * 框架只在同一个 isolate 里记着收到过的消息，所以要分清三种情况：
 * 被引用的那条根本没推过来（群主没开全量消息）、推过来了但落在别的 isolate、推送里的引用索引对不上。
 */

const WINDOW_MS = 2 * 60_000

/** 这个 isolate 的标识与开始处理事件的时间；Workers 的全局作用域里拿不到时间和随机数，第一次处理事件时才定 */
let isolate = ''
let firstEventAt = 0
/** 群 → 最近 2 分钟收到的群消息时间，按全量消息 / @ 消息分开 */
const recent = new Map<string, number[]>()

/** 测试用 */
export function clearRecallDiag(): void {
  isolate = ''
  firstEventAt = 0
  recent.clear()
}

/** 每条群消息都记一下时间，不写库 */
export function noteGroupMessage(session: Session, now = Date.now()): void {
  if (!isolate) {
    isolate = Math.random().toString(36).slice(2, 8)
    firstEventAt = now
  }
  const key = `${session.targetId}:${session.event}`
  const list = (recent.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  list.push(now)
  if (list.length > 50) list.shift()
  recent.set(key, list)
}

function countRecent(groupId: string, event: string, now: number): number {
  return (recent.get(`${groupId}:${event}`) ?? []).filter((t) => now - t < WINDOW_MS).length
}

/** 推送里和引用有关的字段（不带原文），看平台实际推了什么 */
export function quoteFields(raw: unknown): Record<string, unknown> {
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

/**
 * 诊断一次查不到：这个 isolate 最近 2 分钟收到过这个群多少条消息，平台眼里机器人在群里的状态（是否收全量消息）。
 * bot_state 只在查不到时多调一次，平台没开放给这个机器人时把报错记下来
 */
export async function diagnoseMiss(ctx: PluginContext<unknown>, session: Session, now = Date.now()): Promise<Record<string, unknown>> {
  let botState: unknown
  try {
    botState = await ctx.api.group.botState(session.targetId)
  } catch (err) {
    botState = { error: errorText(err) }
  }
  return {
    groupId: session.targetId,
    ...quoteFields(session.raw),
    isolate,
    isolateActiveSec: firstEventAt ? Math.round((now - firstEventAt) / 1000) : 0,
    groupMessages2m: countRecent(session.targetId, 'qq.group.message', now),
    groupAtMessages2m: countRecent(session.targetId, 'qq.group.at_message', now),
    botState,
  }
}
