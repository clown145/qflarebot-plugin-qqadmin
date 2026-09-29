import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { ScopedDB } from '@qqbot/sdk'
// 与线上同一套表名检查：线上会被拦下的 SQL，这里一样抛错
import { flattenForExec, scopeSql, tablePrefix } from '@qqbot/sdk/sqlScope'

export interface TestDB extends ScopedDB {
  sqlite: DatabaseSync
  /** 所有写语句改动的行数之和（三张表都没有二级索引，行数就是 D1 计费的写入行数） */
  rowsWritten: number
  /** 发给数据库的语句条数（每条都是一次子请求） */
  queries: number
}

const isWrite = (sql: string) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql)

/** 用真的 SQLite 跑插件的 SQL：UPSERT、RETURNING、json_set 的语义和 D1 一致 */
export function createSqliteDB(plugin = 'qqadmin'): TestDB {
  const sqlite = new DatabaseSync(':memory:')
  const prefix = tablePrefix(plugin)
  const scope = (sql: string) => scopeSql(sql, prefix)
  const db: TestDB = {
    sqlite,
    rowsWritten: 0,
    queries: 0,
    table: (n) => prefix + n,
    async exec(sql) {
      const flat = flattenForExec(scope(sql))
      if (flat.trim()) sqlite.exec(flat)
    },
    async run(sql, ...params) {
      db.queries += 1
      const r = sqlite.prepare(scope(sql)).run(...(params as SQLInputValue[]))
      db.rowsWritten += Number(r.changes)
      return { changes: Number(r.changes) }
    },
    async all<T>(sql: string, ...params: unknown[]) {
      db.queries += 1
      const rows = sqlite.prepare(scope(sql)).all(...(params as SQLInputValue[])) as T[]
      if (isWrite(sql)) db.rowsWritten += rows.length
      return rows
    },
    async first<T>(sql: string, ...params: unknown[]) {
      db.queries += 1
      const stmt = sqlite.prepare(scope(sql))
      if (isWrite(sql)) {
        // 带 RETURNING 的写语句：改了几行就返回几行
        const rows = stmt.all(...(params as SQLInputValue[])) as T[]
        db.rowsWritten += rows.length
        return rows[0] ?? null
      }
      return (stmt.get(...(params as SQLInputValue[])) as T | undefined) ?? null
    },
  }
  return db
}
