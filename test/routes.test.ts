import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/fields.js'
import { clearGroupCache, loadGroup } from '../src/store/groups.js'
import { calls, type Env, G, route, setup } from './helpers.js'

let env: Env
beforeEach(async () => {
  env = await setup()
  await loadGroup(env.db, G)
  await loadGroup(env.db, 'GROUP_B')
})

describe('管理页面的接口', () => {
  it('页面是单个 HTML，脚本从面板加载桥', async () => {
    const res = await route(env, 'GET', '/ui/')
    const html = await res.text()
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(html).toContain('/tokens.css')
    expect(html).toContain('from"/bridge.js"')
  })

  it('state 给出字段定义、默认群和记下来的群', async () => {
    const state = (await (await route(env, 'GET', '/api/state')).json()) as {
      sections: unknown[]
      defaults: typeof DEFAULT_CONFIG
      groups: Array<{ id: string; follow: boolean }>
    }
    expect(state.sections.length).toBeGreaterThan(0)
    expect(state.defaults).toEqual(DEFAULT_CONFIG)
    expect(state.groups.map((g) => [g.id, g.follow])).toEqual([
      [G, true],
      ['GROUP_B', true],
    ])
  })

  it('保存默认群：跟随的群跟着变；保存独立配置会校验', async () => {
    await route(env, 'PUT', '/api/default', { config: { ...DEFAULT_CONFIG, word_ban_time: 1 } })
    clearGroupCache()
    expect((await loadGroup(env.db, G)).config.word_ban_time).toBe(1)

    const res = await route(env, 'PUT', `/api/groups/${G}`, { follow: false, config: { ...DEFAULT_CONFIG, join_max_time: -3, perms: { vote: '乱写' } } })
    const saved = (await res.json()) as { follow: boolean; config: typeof DEFAULT_CONFIG }
    expect(saved.follow).toBe(false)
    expect(saved.config.join_max_time).toBe(0)
    expect(saved.config.perms.vote).toBe('成员')

    const back = (await (await route(env, 'PUT', `/api/groups/${G}`, { follow: true })).json()) as { follow: boolean; config: typeof DEFAULT_CONFIG }
    expect(back.follow).toBe(true)
    expect(back.config.word_ban_time).toBe(1)
  })

  it('没记下来的群改不了；移除后从列表里消失', async () => {
    expect((await route(env, 'PUT', '/api/groups/NOPE', { follow: true })).status).toBe(404)
    await route(env, 'DELETE', '/api/groups/GROUP_B')
    const state = (await (await route(env, 'GET', '/api/state')).json()) as { groups: Array<{ id: string }> }
    expect(state.groups.map((g) => g.id)).toEqual([G])
  })

  it('群名现查，一次最多 40 个', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `G${i}`)
    const res = (await (await route(env, 'POST', '/api/names', { ids })).json()) as { names: Record<string, string | null> }
    expect(Object.keys(res.names)).toHaveLength(40)
    expect(calls(env, 'GET', '/info')).toHaveLength(40)
  })
})
