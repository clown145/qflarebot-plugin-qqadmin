import { ALL_FIELDS, CN_NAMES, type FieldDef, type GroupConfig, MAX_BAN_SECONDS } from './fields.js'

type Obj = Record<string, unknown>

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const part of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Obj)[part]
  }
  return cur
}

function setPath(obj: Obj, path: string, value: unknown): void {
  const parts = path.split('.')
  let cur = obj
  for (const part of parts.slice(0, -1)) {
    if (!cur[part] || typeof cur[part] !== 'object') cur[part] = {}
    cur = cur[part] as Obj
  }
  cur[parts[parts.length - 1]!] = value
}

/** 一个字段的值合不合法；不合法返回 undefined，调用方退回旧值 */
function coerce(field: FieldDef, value: unknown): unknown {
  switch (field.type) {
    case 'bool':
      return typeof value === 'boolean' ? value : undefined
    case 'int': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
      if (!Number.isFinite(n)) return undefined
      return Math.min(field.max, Math.max(field.min, Math.trunc(n)))
    }
    case 'string':
      return typeof value === 'string' ? value : undefined
    case 'list':
      if (!Array.isArray(value)) return undefined
      return [...new Set(value.map((v) => String(v).trim()).filter(Boolean))]
    case 'select':
      return typeof value === 'string' && field.options.includes(value) ? value : undefined
  }
}

/**
 * 把存储里或页面提交来的值整理成完整的配置：逐个字段校验，缺的、类型不对的取 base 里的值。
 * 升级后新加的字段，老数据里没有，也就自动用上默认值
 */
export function normalizeConfig(raw: unknown, base: GroupConfig): GroupConfig {
  const out = structuredClone(base) as unknown as Obj
  for (const field of ALL_FIELDS) {
    const value = coerce(field, getPath(raw, field.key))
    if (value !== undefined) setPath(out, field.key, value)
  }
  return out as unknown as GroupConfig
}

/** 开/关 这类参数；认不出来返回 undefined（上游认不出时当「关」，没带参数的查看也被写成了关） */
export function parseBool(text: string | undefined): boolean | undefined {
  switch ((text ?? '').trim().toLowerCase()) {
    case '开':
    case '开启':
    case '启用':
    case 'on':
    case 'true':
    case '1':
    case '是':
    case '真':
      return true
    case '关':
    case '关闭':
    case '禁用':
    case 'off':
    case 'false':
    case '0':
    case '否':
    case '假':
      return false
    default:
      return undefined
  }
}

export const onOff = (v: boolean) => (v ? '开' : '关')

/** 上游直接打印 Python 列表，保留那个样子：['a', 'b'] */
export function pyList(items: readonly string[]): string {
  return `[${items.map((i) => `'${i}'`).join(', ')}]`
}

/** 参数里的整数；没有或不是整数返回 undefined */
export function intArg(args: readonly string[]): number | undefined {
  const token = args.find((a) => /^-?\d+$/.test(a))
  return token === undefined ? undefined : Number(token)
}

/** 解析「30~300」；格式不对退回 30~300（上游同样的兜底） */
export function banRange(text: string): [number, number] {
  const m = /^\s*(\d+)\s*~\s*(\d+)\s*$/.exec(text)
  let [min, max] = m ? [Number(m[1]), Number(m[2])] : [30, 300]
  min = Math.max(min, 1)
  max = Math.min(Math.max(max, min), MAX_BAN_SECONDS)
  return [min, max]
}

/** 指定了秒数就用它（限制在 0 到 30 天），没指定就在随机范围里挑一个 */
export function banSeconds(cfg: GroupConfig, seconds: number | undefined, random: () => number = Math.random): number {
  if (seconds !== undefined) return Math.min(Math.max(seconds, 0), MAX_BAN_SECONDS)
  const [min, max] = banRange(cfg.random_ban_time)
  return min + Math.floor(random() * (max - min + 1))
}

const CN_FIELDS = ALL_FIELDS.filter((f) => f.key in CN_NAMES)
const BY_CN = new Map(CN_FIELDS.map((f) => [CN_NAMES[f.key]!, f]))

/** 「群管配置」的输出：中文键名，列表用空格分隔，开关写开/关 */
export function exportCnLines(cfg: GroupConfig): string {
  return CN_FIELDS.map((f) => {
    const value = getPath(cfg, f.key)
    const text = Array.isArray(value) ? value.join(' ') : typeof value === 'boolean' ? onOff(value) : String(value)
    return `${CN_NAMES[f.key]}: ${text}`
  }).join('\n')
}

/**
 * 「群管配置 <配置串>」：每行「中文键: 值」，认不出的键和值跳过（值保持原样）。
 * 冒号全角半角都认（上游只认半角）
 */
export function importCnLines(cfg: GroupConfig, text: string): GroupConfig {
  const next = structuredClone(cfg) as unknown as Obj
  for (const line of text.split(/\r?\n/)) {
    const m = /^([^:：]+)[:：](.*)$/.exec(line)
    if (!m) continue
    const field = BY_CN.get(m[1]!.trim())
    if (!field) continue
    const raw = m[2]!.trim()
    const value = field.type === 'bool' ? parseBool(raw) : field.type === 'list' ? raw.split(/\s+/).filter(Boolean) : raw
    const ok = value === undefined ? undefined : coerce(field, value)
    if (ok !== undefined) setPath(next, field.key, ok)
  }
  return next as unknown as GroupConfig
}
