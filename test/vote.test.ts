import type { MuteOp } from '@qqbot/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settleExpiredVotes } from '../src/commands/vote.js'
import { getVote } from '../src/store/votes.js'
import { ADMIN, at, calls, command, type Env, G, setup, text } from './helpers.js'

let env: Env
beforeEach(async () => {
  env = await setup()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(10_000_000)
})
afterEach(() => {
  vi.useRealTimers()
})

const member = (id: string) => ({ memberRole: 'member' as const, userId: id })
const muteOps = () => calls(env, 'POST', 'restrict_chat_setting').flatMap((c) => (c.body as { members: MuteOp[] }).members)

describe('投票禁言', () => {
  it('发起后够票立即禁言；同一人再投只改立场', async () => {
    const start = await command(env, '投票禁言', '90', { ...member('A'), ...at('T') })
    expect(text(start)).toBe('已发起对 <@T> 的禁言投票(禁言90秒)，输入“赞同禁言/反对禁言”进行表态，120秒后结算')
    expect(text(await command(env, '投票禁言', '', { ...member('B'), ...at('T') }))).toBe('群内已有正在进行的禁言投票')

    expect(text(await command(env, '赞同禁言', '', member('A')))).toBe('禁言【<@T>】：\n赞同(1/3)\n反对(0/3)')
    expect(text(await command(env, '反对禁言', '', member('A')))).toBe('禁言【<@T>】：\n赞同(0/3)\n反对(1/3)')
    await command(env, '赞同禁言', '', member('A'))
    await command(env, '赞同禁言', '', member('B'))
    const done = await command(env, '赞同禁言', '', member('C'))
    expect(text(done)).toBe('投票通过！已禁言<@T>')
    expect(muteOps().map((o) => [o.op, o.memberOpenid])).toEqual([['add', 'T']])
    expect(await getVote(env.db, G)).toBeNull()
    expect(text(await command(env, '赞同禁言', '', member('D')))).toBe('当前没有进行中的禁言投票')
  })

  it('反对票够了就否决', async () => {
    await command(env, '投票禁言', '', { ...member('A'), ...at('T') })
    for (const id of ['A', 'B']) await command(env, '反对禁言', '', member(id))
    expect(text(await command(env, '反对禁言', '', member('C')))).toBe('禁言投票被否决，<@T>安全了')
    expect(muteOps()).toEqual([])
  })

  it('到点由定时任务结算：赞同多于反对就禁言，平票否决；结果主动发到群里', async () => {
    await command(env, '投票禁言', '', { ...member('A'), ...at('T') })
    await command(env, '赞同禁言', '', member('A'))
    await command(env, '投票禁言', '', { ...member('A'), ...at('T2'), targetId: 'G2' })

    vi.setSystemTime(10_000_000 + 60_000)
    await settleExpiredVotes(env.ctx)
    expect(calls(env, 'POST', 'send:')).toEqual([])

    vi.setSystemTime(10_000_000 + 121_000)
    await settleExpiredVotes(env.ctx)
    const sent = calls(env, 'POST', 'send:').map((c) => [c.path, (c.body as { message: string }).message])
    expect(sent).toHaveLength(2)
    expect(sent).toEqual(
      expect.arrayContaining([
        [`send:group:${G}`, '投票时间到！已禁言<@T>'],
        ['send:group:G2', '投票时间到！禁言被否决，<@T2>安全了'],
      ]),
    )
    expect(muteOps().map((o) => o.memberOpenid)).toEqual(['T'])
  })

  it('到点后还没结算时，下一次投票就结算；动不了超管', async () => {
    await command(env, '投票禁言', '', { ...member('A'), ...at('T') })
    vi.setSystemTime(10_000_000 + 121_000)
    expect(text(await command(env, '赞同禁言', '', member('B')))).toBe('投票时间到！禁言被否决，<@T>安全了')
    expect(text(await command(env, '投票禁言', '', { ...member('A'), ...at(ADMIN) }))).toBe('我动不了超管')
  })
})
