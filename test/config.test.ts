import { describe, expect, it } from 'vitest'
import { banRange, banSeconds, exportCnLines, importCnLines, normalizeConfig, parseBool } from '../src/config.js'
import { DEFAULT_CONFIG, MAX_BAN_SECONDS } from '../src/fields.js'

describe('normalizeConfig', () => {
  it('缺的、类型不对的字段取 base，数字限制在范围里，列表去重去空', () => {
    const cfg = normalizeConfig(
      {
        join_switch: 'yes',
        join_max_time: 999,
        custom_ban_words: [' a ', 'a', '', 'b'],
        vote_ban: { ttl: 10 },
        perms: { set_group_ban: '成员', delete_msg: '高等级成员' },
      },
      DEFAULT_CONFIG,
    )
    expect(cfg.join_switch).toBe(true)
    expect(cfg.join_max_time).toBe(100)
    expect(cfg.custom_ban_words).toEqual(['a', 'b'])
    expect(cfg.vote_ban).toEqual({ ttl: 60, threshold: 3 })
    expect(cfg.perms.set_group_ban).toBe('成员')
    // 上游有、这边没有的「高等级成员」不认，留原值
    expect(cfg.perms.delete_msg).toBe('成员')
    expect(cfg.word_ban_time).toBe(360)
  })

  it('不改动 base', () => {
    const base = structuredClone(DEFAULT_CONFIG)
    normalizeConfig({ custom_ban_words: ['x'] }, base)
    expect(base).toEqual(DEFAULT_CONFIG)
  })
})

describe('开关与禁言时长', () => {
  it('认不出的开关参数是 undefined（上游当成关）', () => {
    expect(parseBool('开')).toBe(true)
    expect(parseBool('OFF')).toBe(false)
    expect(parseBool(undefined)).toBeUndefined()
    expect(parseBool('随便')).toBeUndefined()
  })

  it('随机范围格式不对退回 30~300，指定秒数限制在 30 天内', () => {
    expect(banRange('10~20')).toEqual([10, 20])
    expect(banRange('坏的')).toEqual([30, 300])
    expect(banRange('0~0')).toEqual([1, 1])
    const cfg = { ...DEFAULT_CONFIG, random_ban_time: '10~20' }
    expect(banSeconds(cfg, undefined, () => 0)).toBe(10)
    expect(banSeconds(cfg, undefined, () => 0.999)).toBe(20)
    expect(banSeconds(cfg, 99999999)).toBe(MAX_BAN_SECONDS)
    expect(banSeconds(cfg, -5)).toBe(0)
  })
})

describe('群管配置的中文文本', () => {
  it('导出后原样导入不变', () => {
    const text = exportCnLines(DEFAULT_CONFIG)
    expect(text).toContain('进群审核: 开')
    expect(text).toContain('自定义违禁词: 禁词1 禁词2')
    expect(importCnLines(DEFAULT_CONFIG, text)).toEqual(DEFAULT_CONFIG)
  })

  it('改几项，全角冒号也认；认不出的键和值跳过', () => {
    const next = importCnLines(DEFAULT_CONFIG, '进群审核：关\n禁词禁言时长: 60\n进群尝试次数: 很多\n不存在: 1\n进群白词: 你好 hello')
    expect(next.join_switch).toBe(false)
    expect(next.word_ban_time).toBe(60)
    expect(next.join_max_time).toBe(DEFAULT_CONFIG.join_max_time)
    expect(next.join_accept_words).toEqual(['你好', 'hello'])
  })
})
