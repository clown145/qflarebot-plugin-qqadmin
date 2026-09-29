import { type EventInput, type PluginContext, qqAt, type Session } from '@qqbot/sdk'
import { errorText, muteMember } from './actions.js'
import type { GroupConfig } from './fields.js'
import lexicon from './lexicon.json'
import { loadGroup } from './store/groups.js'

const BUILTIN_WORDS = lexicon.words.map((w) => w.toLowerCase()).filter(Boolean)

/** 刷屏判定：连续这么多条、每两条间隔都小于这么多秒（上游写死的 5 条、0.5 秒） */
const SPAM_COUNT = 5
const SPAM_INTERVAL = 0.5

/**
 * 以下状态都在内存里，和上游一样丢了也无所谓：刷屏计数本来就只看最近几秒。
 * 开了全量消息的群，一条 @ 消息可能既推 at_message 又推全量消息，按消息 id 去重，别检测两遍
 */
const seen: string[] = []
const seenSet = new Set<string>()
const stamps = new Map<string, number[]>()
const lastBanned = new Map<string, number>()

/** 测试用 */
export function clearModerationState(): void {
  seen.length = 0
  seenSet.clear()
  stamps.clear()
  lastBanned.clear()
}

function firstTime(messageId: string): boolean {
  if (seenSet.has(messageId)) return false
  seenSet.add(messageId)
  seen.push(messageId)
  if (seen.length > 500) seenSet.delete(seen.shift()!)
  return true
}

/** 检测违禁词：撤回，按设置禁言发送者（上游 on_ban_words，Bot 管理员不查） */
async function checkWords(ctx: PluginContext<unknown>, session: Session, cfg: GroupConfig): Promise<boolean> {
  if (session.isBotAdmin) return false
  const msg = session.content.toLowerCase()
  if (!msg) return false
  // 上游只把消息转成小写，词表里带大写字母的词永远匹配不上
  const custom = cfg.custom_ban_words.map((w) => w.toLowerCase()).filter(Boolean)
  const hit = custom.some((w) => msg.includes(w)) || (cfg.builtin_ban && BUILTIN_WORDS.some((w) => msg.includes(w)))
  if (!hit) return false
  await session.recall(session.messageId)
  if (cfg.word_ban_time > 0) {
    try {
      await muteMember(ctx, session.targetId, session.userId, cfg.word_ban_time)
    } catch (err) {
      ctx.logger.error(`bot在群${session.targetId}权限不足，禁言失败`, { error: errorText(err) })
    }
  }
  return true
}

/** 刷屏检测与禁言（上游 spamming_ban） */
async function checkSpam(ctx: PluginContext<unknown>, session: Session, cfg: GroupConfig): Promise<void> {
  const banTime = cfg.spamming_ban_time
  if (banTime <= 0) return
  const key = `${session.targetId}:${session.userId}`
  const now = Date.now() / 1000
  if (now - (lastBanned.get(key) ?? 0) < banTime) return

  const list = stamps.get(key) ?? []
  list.push(now)
  if (list.length > SPAM_COUNT) list.shift()
  stamps.set(key, list)
  if (stamps.size > 2000) pruneStamps(now)
  if (list.length < SPAM_COUNT) return
  for (let i = 1; i < list.length; i++) if (list[i]! - list[i - 1]! >= SPAM_INTERVAL) return

  // 提前写入禁止标记，防止并发重复禁
  lastBanned.set(key, now)
  list.length = 0
  try {
    await muteMember(ctx, session.targetId, session.userId, banTime)
    await session.reply(`检测到${session.userName || qqAt(session.userId)}刷屏，已禁言`)
  } catch (err) {
    ctx.logger.error(`bot在群${session.targetId}权限不足，禁言失败`, { error: errorText(err) })
  }
}

function pruneStamps(now: number): void {
  for (const [key, list] of stamps) if (now - (list[list.length - 1] ?? 0) > 60) stamps.delete(key)
}

/** 每条群消息都会经过这里：只读内存里缓存的设置，不写库 */
export async function moderate({ session, ctx }: EventInput): Promise<void> {
  if (session.scene !== 'group' || !session.messageId || !session.targetId || !session.userId) return
  if (!session.content && !session.attachments.length) return
  if (!firstTime(session.messageId)) return
  const group = await loadGroup(ctx.db, session.targetId)
  await checkWords(ctx, session, group.config)
  await checkSpam(ctx, session, group.config)
}
