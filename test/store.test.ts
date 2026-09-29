import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/fields.js'
import {
  clearGroupCache,
  followDefault,
  listGroups,
  loadGroup,
  resetAllGroups,
  saveDefault,
  updateGroup,
} from '../src/store/groups.js'
import { type Env, G, setup } from './helpers.js'

let env: Env
beforeEach(async () => {
  env = await setup()
})

describe('群配置', () => {
  it('群第一次出现时补一行「跟随默认」，只写这一次；之后读走缓存', async () => {
    const first = await loadGroup(env.db, G)
    expect(first.follow).toBe(true)
    expect(first.config).toEqual(DEFAULT_CONFIG)
    expect(env.db.rowsWritten).toBe(1)

    const queries = env.db.queries
    await loadGroup(env.db, G)
    expect(env.db.queries).toBe(queries)

    // 缓存过期或换了实例：再查一次，但不会再写
    clearGroupCache()
    await loadGroup(env.db, G)
    expect(env.db.rowsWritten).toBe(1)
  })

  it('改一项就把当前生效的配置整份存成独立配置，之后默认群改了也不跟着变', async () => {
    const group = await loadGroup(env.db, G)
    await updateGroup(env.db, group, (c) => void (c.word_ban_time = 10))
    await saveDefault(env.db, { ...DEFAULT_CONFIG, spamming_ban_time: 30 })
    clearGroupCache()
    const after = await loadGroup(env.db, G)
    expect(after.follow).toBe(false)
    expect(after.config.word_ban_time).toBe(10)
    expect(after.config.spamming_ban_time).toBe(0)
    expect(after.defaults.spamming_ban_time).toBe(30)
  })

  it('跟随默认的群用默认群的配置；恢复跟随、全部重置只改有独立配置的行', async () => {
    await saveDefault(env.db, { ...DEFAULT_CONFIG, spamming_ban_time: 30 })
    const a = await loadGroup(env.db, G)
    expect(a.config.spamming_ban_time).toBe(30)
    await updateGroup(env.db, a, (c) => void (c.builtin_ban = true))
    await loadGroup(env.db, 'GROUP_B')

    const before = env.db.rowsWritten
    await resetAllGroups(env.db)
    expect(env.db.rowsWritten - before).toBe(1)
    expect((await loadGroup(env.db, G)).follow).toBe(true)

    await updateGroup(env.db, await loadGroup(env.db, G), (c) => void (c.builtin_ban = true))
    await followDefault(env.db, G)
    const listing = await listGroups(env.db)
    expect(listing.groups.map((g) => [g.id, g.follow])).toEqual([
      [G, true],
      ['GROUP_B', true],
    ])
    expect(listing.defaults.spamming_ban_time).toBe(30)
  })
})
