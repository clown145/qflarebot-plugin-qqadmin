import type { Bridge } from 'panel-bridge'
import type { GroupConfig, SectionDef } from '../src/fields.js'

export interface GroupEntry {
  id: string
  follow: boolean
  config: GroupConfig
}

export interface State {
  sections: SectionDef[]
  defaults: GroupConfig
  groups: GroupEntry[]
}

/** 插件自己的接口（src/web/routes.ts），全部 auth: 'admin'，桥会带上令牌 */
export function createApi(bridge: Bridge) {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await bridge.fetch(path, init)
    const data = (await res.json().catch(() => ({}))) as T & { error?: string }
    if (!res.ok) throw new Error(data.error ?? `请求失败（${res.status}）`)
    return data
  }
  const send = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  return {
    state: () => call<State>('/api/state'),
    names: (ids: string[]) => call<{ names: Record<string, string | null> }>('/api/names', send('POST', { ids })),
    saveDefault: (config: unknown) => call<{ config: GroupConfig }>('/api/default', send('PUT', { config })),
    saveGroup: (id: string, follow: boolean, config: unknown) =>
      call<GroupEntry>(`/api/groups/${encodeURIComponent(id)}`, send('PUT', { follow, config })),
    removeGroup: (id: string) => call<{ ok: true }>(`/api/groups/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  }
}

export type Api = ReturnType<typeof createApi>
