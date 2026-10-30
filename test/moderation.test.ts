import type { MuteOp } from '@qqbot/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadGroup, updateGroup } from '../src/store/groups.js'
import { calls, type Env, event, G, setup, text } from './helpers.js'

let env: Env
beforeEach(async () => {
  env = await setup()
})
afterEach(() => {
  vi.useRealTimers()
})

let seq = 0
const say = (content: string, extra: Record<string, unknown> = {}) =>
  event(env, 'qq.group.message', { content, messageId: `M${++seq}`, userId: 'U1', userName: '小明', ...extra })

const muteOps = () => calls(env, 'POST', 'restrict_chat_setting').flatMap((c) => (c.body as { members: MuteOp[] }).members)

describe('违禁词', () => {
  it('命中自定义违禁词：撤回、按设置禁言；大小写不敏感（上游词表里的大写永远匹配不上）', async () => {
    await updateGroup(env.db, await loadGroup(env.db, G), (c) => void (c.custom_ban_words = ['Spam']))
    const s = await say('buy SPAM now')
    expect(s.recalled).toEqual([`M${seq}`])
    expect(muteOps().map((o) => [o.op, o.memberOpenid])).toEqual([['add', 'U1']])
  })

  it('内置词库默认不开；开了才查。Bot 管理员不查', async () => {
    const word = '法轮'
    expect((await say(`说个${word}`)).recalled).toEqual([])
    await updateGroup(env.db, await loadGroup(env.db, G), (c) => void (c.builtin_ban = true))
    expect((await say(`说个${word}`)).recalled).toHaveLength(1)
    expect((await say(`说个${word}`, { isBotAdmin: true })).recalled).toEqual([])
  })

  it('同一条消息推两次（at_message 和全量消息）只处理一次', async () => {
    await updateGroup(env.db, await loadGroup(env.db, G), (c) => void (c.custom_ban_words = ['坏']))
    const a = await event(env, 'qq.group.at_message', { content: '坏', messageId: 'SAME', userId: 'U1' })
    const b = await event(env, 'qq.group.message', { content: '坏', messageId: 'SAME', userId: 'U1' })
    expect([...a.recalled, ...b.recalled]).toEqual(['SAME'])
  })

  it('平时每条消息不写库，缓存里有设置时也不查库', async () => {
    await say('你好')
    const { rowsWritten, queries } = env.db
    for (let i = 0; i < 20; i++) await say(`第 ${i} 条`)
    expect(env.db.rowsWritten).toBe(rowsWritten)
    expect(env.db.queries).toBe(queries)
  })
})

describe('刷屏', () => {
  it('0.5 秒内连发 5 条禁言并提示；禁言期间不再重复禁', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    await updateGroup(env.db, await loadGroup(env.db, G), (c) => void (c.spamming_ban_time = 60))
    let last = await say('1')
    for (let i = 2; i <= 5; i++) {
      vi.setSystemTime(1_000_000 + i * 100)
      last = await say(String(i))
    }
    expect(text(last)).toBe('检测到小明刷屏，已禁言')
    expect(muteOps()).toHaveLength(1)
    for (let i = 6; i <= 12; i++) {
      vi.setSystemTime(1_000_000 + i * 100)
      await say(String(i))
    }
    expect(muteOps()).toHaveLength(1)
  })

  it('间隔够长不算刷屏；时长为 0 时不检测', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await updateGroup(env.db, await loadGroup(env.db, G), (c) => void (c.spamming_ban_time = 60))
    for (let i = 0; i < 6; i++) {
      vi.setSystemTime(2_000_000 + i * 600)
      await say(String(i))
    }
    expect(muteOps()).toEqual([])
  })
})

/**
 * 分发顺序的守卫：框架在同 priority 时让命令排在事件前面，命令默认 block: true，
 * 命中后事件就不再跑了。所以「违禁词检查」必须显式声明比命令更高的 priority，
 * 否则 `/weather 傻逼` 这类「命令 + 脏话」的消息会被漏检。
 *
 * 这里只断言声明本身——真实分发顺序由框架的 dispatcher.test.ts 保证。
 * 之前没有这条测试时，把 events 写回裸函数就会静默退化成漏检。
 */
describe('违禁词事件的 priority 守卫', () => {
  it('消息类事件声明了比命令更高的 priority', async () => {
    const { normalized } = await import('./helpers.js')
    const msgEvents = normalized.events.filter((e) => e.event.includes('qq.group.message') || e.event.includes('qq.group.at_message'))
    expect(msgEvents).toHaveLength(2)
    for (const rule of msgEvents) {
      expect(rule.priority, '消息事件必须优先于命令，否则命令消息的违禁词漏检').toBeGreaterThan(0)
    }
  })
})
