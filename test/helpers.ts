import { deliverReply, type EventName, normalizePlugin, type OutgoingMessage, type PluginContext } from '@qqbot/sdk'
import { createMockContext, createMockSession, type createRecordingApi, type MockSession, type MockSessionOptions } from '@qqbot/sdk/testing'
import plugin from '../src/index.js'
import { clearModerationState } from '../src/moderation.js'
import { clearRecallDiag } from '../src/recallDiag.js'
import { clearGroupCache } from '../src/store/groups.js'
import { initSchema } from '../src/store/schema.js'
import { createSqliteDB, type TestDB } from './sqlite.js'

export const G = 'GROUP_A'
export const ADMIN = 'BOTADMIN0000000000000001'

type RecordingApi = ReturnType<typeof createRecordingApi>

export interface Env {
  db: TestDB
  ctx: PluginContext<unknown>
  api: RecordingApi
}

export async function setup(): Promise<Env> {
  clearGroupCache()
  clearModerationState()
  clearRecallDiag()
  const db = createSqliteDB()
  await initSchema(db)
  const ctx = createMockContext(plugin, { db, botAdmins: [ADMIN] })
  return { db, ctx, api: ctx.api as RecordingApi }
}

/** 归一化后的插件定义：测分发语义（priority / block）时用，别绕过框架直接调 handler */
export const normalized = normalizePlugin(plugin)
const n = normalized

/** 群友在群里发命令；who 默认是群管理员 */
export async function command(env: Env, name: string, argText = '', session: MockSessionOptions = {}): Promise<MockSession> {
  const cmd = n.commands.find((c) => c.name === name || c.aliases?.includes(name))
  if (!cmd) throw new Error(`没有命令 ${name}`)
  const s = createMockSession({ content: `/${name} ${argText}`.trim(), targetId: G, memberRole: 'admin', ...session })
  const text = argText.trim()
  await deliverReply(s, await cmd.handler({ session: s, ctx: env.ctx, command: name, args: text ? text.split(/\s+/) : [], argText: text }))
  return s
}

export async function event(env: Env, name: EventName, session: MockSessionOptions = {}): Promise<MockSession> {
  const rule = n.events.find((e) => e.event.includes(name))
  if (!rule) throw new Error(`没有事件 ${name}`)
  const s = createMockSession({ event: name, targetId: G, ...session })
  await deliverReply(s, await rule.handler({ session: s, ctx: env.ctx }))
  return s
}

export async function click(env: Env, id: string, data: string, session: MockSessionOptions = {}) {
  const rule = n.buttons.find((b) => b.id === id)
  if (!rule) throw new Error(`没有按钮 ${id}`)
  const s = createMockSession({ messageId: null, interaction: { buttonId: id, buttonData: data }, targetId: G, ...session })
  const result = await rule.handler({ session: s, ctx: env.ctx, interaction: s.interaction!, buttonId: id, buttonData: data })
  if (typeof result === 'number') return { session: s, code: result }
  await deliverReply(s, result)
  return { session: s, code: undefined }
}

export async function route(env: Env, method: string, path: string, body?: unknown): Promise<Response> {
  for (const r of plugin.routes ?? []) {
    if (r.method !== method) continue
    const params: Record<string, string> = {}
    const pattern = r.path.split('/')
    const parts = path.split('/')
    const ok =
      pattern.length === parts.length &&
      pattern.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(parts[i]!)), true) : p === '*' || p === parts[i]))
    if (!ok) continue
    const request = new Request(`https://bot.example.com/p/qqadmin${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    })
    return r.handler({ ctx: env.ctx, request, params, authenticated: true })
  }
  throw new Error(`没有路由 ${method} ${path}`)
}

/** 回复的文字 */
export function text(s: MockSession): string {
  return s.replies.map((r: OutgoingMessage) => (typeof r === 'string' ? r : (r.text ?? r.markdown?.content ?? ''))).join('\n---\n')
}

/** 被 @ 的群友：mentions 里有，原始正文里也有 */
export function at(...ids: string[]): Pick<MockSessionOptions, 'mentions' | 'raw'> {
  return {
    mentions: ids.map((id) => ({ id, username: '', bot: false })),
    raw: { content: ids.map((id) => `<@${id}>`).join(' ') },
  }
}

export function calls(env: Env, method: string, pathPart: string) {
  return env.api.calls.filter((c) => c.method === method && c.path.includes(pathPart))
}
