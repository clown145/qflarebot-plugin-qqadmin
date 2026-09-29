import type { ScopedDB } from '@qqbot/sdk'
import { normalizeConfig } from '../config.js'
import { DEFAULT_CONFIG, type GroupConfig } from '../fields.js'

/** {groups} 里存「默认群」的那一行 */
export const DEFAULT_ID = '__default__'

/** 读到的行在内存里留多久；别的实例改了设置，这边最多晚这么久看到 */
const CACHE_TTL = 60_000

interface Row {
  follow: boolean
  data: unknown
}

interface DbRow {
  group_id: string
  follow: number
  data: string
}

const cache = new Map<string, { row: Row | null; at: number }>()

/** 测试用：清掉内存缓存 */
export function clearGroupCache(): void {
  cache.clear()
}

function parse(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return {}
  }
}

const toRow = (r: DbRow): Row => ({ follow: r.follow === 1, data: parse(r.data) })

/** 一次查询取齐这几行，缓存里有的不查 */
async function readRows(db: ScopedDB, ids: string[], now: number): Promise<Map<string, Row | null>> {
  const out = new Map<string, Row | null>()
  const missing: string[] = []
  for (const id of ids) {
    const hit = cache.get(id)
    if (hit && now - hit.at < CACHE_TTL) out.set(id, hit.row)
    else missing.push(id)
  }
  if (missing.length) {
    const rows = await db.all<DbRow>(
      `SELECT group_id, follow, data FROM {groups} WHERE group_id IN (${missing.map(() => '?').join(', ')})`,
      ...missing,
    )
    for (const id of missing) {
      const found = rows.find((r) => r.group_id === id)
      const row = found ? toRow(found) : null
      cache.set(id, { row, at: now })
      out.set(id, row)
    }
  }
  return out
}

function defaultsOf(row: Row | null | undefined): GroupConfig {
  return row ? normalizeConfig(row.data, DEFAULT_CONFIG) : structuredClone(DEFAULT_CONFIG)
}

export interface GroupState {
  id: string
  /** 跟随默认配置 */
  follow: boolean
  /** 本群实际生效的配置（跟随时就是默认群的），只读 */
  config: GroupConfig
  defaults: GroupConfig
}

/** 本群的配置。群第一次出现时补一行「跟随默认」，管理页面的群列表靠它 */
export async function loadGroup(db: ScopedDB, groupId: string, now = Date.now()): Promise<GroupState> {
  const rows = await readRows(db, [groupId, DEFAULT_ID], now)
  let row = rows.get(groupId) ?? null
  if (!row) {
    await db.run(
      `INSERT INTO {groups} (group_id, follow, data, updated_at) VALUES (?, 1, '{}', ?) ON CONFLICT (group_id) DO NOTHING`,
      groupId,
      now,
    )
    row = { follow: true, data: {} }
    cache.set(groupId, { row, at: now })
  }
  const defaults = defaultsOf(rows.get(DEFAULT_ID))
  return { id: groupId, follow: row.follow, config: row.follow ? defaults : normalizeConfig(row.data, defaults), defaults }
}

async function upsert(db: ScopedDB, groupId: string, row: Row, now: number): Promise<void> {
  await db.run(
    `INSERT INTO {groups} (group_id, follow, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (group_id) DO UPDATE SET follow = excluded.follow, data = excluded.data, updated_at = excluded.updated_at`,
    groupId,
    row.follow ? 1 : 0,
    JSON.stringify(row.data),
    now,
  )
  cache.set(groupId, { row, at: now })
}

/** 本群改成独立配置并整份存下（上游改一项时也是先把默认群整份抄过来） */
export async function saveGroup(db: ScopedDB, groupId: string, config: GroupConfig, now = Date.now()): Promise<void> {
  await upsert(db, groupId, { follow: false, data: config }, now)
}

/** 在当前生效的配置上改几项再存成独立配置；返回改完的配置 */
export async function updateGroup(
  db: ScopedDB,
  group: GroupState,
  change: (cfg: GroupConfig) => void,
  now = Date.now(),
): Promise<GroupConfig> {
  const next = structuredClone(group.config)
  change(next)
  await saveGroup(db, group.id, next, now)
  return next
}

export async function followDefault(db: ScopedDB, groupId: string, now = Date.now()): Promise<void> {
  await upsert(db, groupId, { follow: true, data: {} }, now)
}

export async function saveDefault(db: ScopedDB, config: GroupConfig, now = Date.now()): Promise<void> {
  await upsert(db, DEFAULT_ID, { follow: false, data: config }, now)
}

/** 所有群重新跟随默认配置；只改有独立配置的行 */
export async function resetAllGroups(db: ScopedDB, now = Date.now()): Promise<void> {
  await db.run(`UPDATE {groups} SET follow = 1, data = '{}', updated_at = ? WHERE follow = 0 AND group_id != ?`, now, DEFAULT_ID)
  cache.clear()
}

export async function removeGroup(db: ScopedDB, groupId: string): Promise<void> {
  await db.run('DELETE FROM {groups} WHERE group_id = ?', groupId)
  cache.delete(groupId)
}

export interface GroupListing {
  defaults: GroupConfig
  groups: Array<{ id: string; follow: boolean; config: GroupConfig }>
}

/** 管理页面用：默认群和所有记下来的群 */
export async function listGroups(db: ScopedDB): Promise<GroupListing> {
  const rows = await db.all<DbRow>('SELECT group_id, follow, data FROM {groups}')
  const own = rows.find((r) => r.group_id === DEFAULT_ID)
  const defaults = defaultsOf(own ? toRow(own) : null)
  const groups = rows
    .filter((r) => r.group_id !== DEFAULT_ID)
    .map((r) => {
      const row = toRow(r)
      return { id: r.group_id, follow: row.follow, config: row.follow ? defaults : normalizeConfig(row.data, defaults) }
    })
  return { defaults, groups }
}

/** 这个群有没有记下来（页面只能改记下来的群） */
export async function groupExists(db: ScopedDB, groupId: string): Promise<boolean> {
  return (await db.first('SELECT group_id FROM {groups} WHERE group_id = ?', groupId)) !== null
}
