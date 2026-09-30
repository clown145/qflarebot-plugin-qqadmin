import type { MuteOp } from '@qqbot/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadGroup, saveGroup } from '../src/store/groups.js'
import { ADMIN, at, calls, command, type Env, G, setup, text } from './helpers.js'

let env: Env
beforeEach(async () => {
  env = await setup()
})

const muteOps = () => calls(env, 'POST', 'restrict_chat_setting').flatMap((c) => (c.body as { members: MuteOp[] }).members)

describe('权限', () => {
  it('按配置判断，不够就回「你没X权限」；Bot 管理员是超管', async () => {
    const member = await command(env, '禁言', '60', { memberRole: 'member', ...at('U1') })
    expect(text(member)).toBe('你没管理员权限')
    expect(muteOps()).toEqual([])

    const admin = await command(env, '禁言', '60', { memberRole: undefined, isBotAdmin: true, ...at('U1') })
    expect(text(admin)).toBe('用户[<@U1>]已被禁言60秒')
  })

  it('权限可以按群改：禁言放开给成员（上游这一项写成了改名的，改了不生效）', async () => {
    const group = await loadGroup(env.db, G)
    await saveGroup(env.db, G, { ...group.config, perms: { ...group.config.perms, set_group_ban: '成员' } })
    const s = await command(env, '禁言', '60', { memberRole: 'member', ...at('U1') })
    expect(text(s)).toBe('用户[<@U1>]已被禁言60秒')
  })
})

describe('禁言、解禁、撤回', () => {
  it('禁言：不写秒数在随机范围里挑，一人一行；动不了超管', async () => {
    const s = await command(env, '禁言', '', at('U1', 'U2'))
    const ops = muteOps()
    expect(ops.map((o) => [o.op, o.memberOpenid])).toEqual([
      ['add', 'U1'],
      ['add', 'U2'],
    ])
    const seconds = Number(/已被禁言(\d+)秒/.exec(text(s))![1])
    expect(seconds).toBeGreaterThanOrEqual(30)
    expect(seconds).toBeLessThanOrEqual(300)

    expect(text(await command(env, '禁言', '60', at(ADMIN)))).toBe('我动不了超管')
    expect(text(await command(env, '禁言', '60'))).toBe('未指定要禁言的用户')
  })

  it('禁言失败时逐人报告', async () => {
    env.api.group.mute = async () => {
      throw new Error('无权限')
    }
    expect(text(await command(env, '禁言', '60', at('U1')))).toBe('用户[<@U1>]禁言失败')
  })

  it('解禁删掉禁言', async () => {
    const s = await command(env, '解禁', '', at('U1'))
    expect(muteOps()).toEqual([{ op: 'del', memberOpenid: 'U1' }])
    expect(text(s)).toBe('用户[<@U1>]已解除禁言')
  })

  it('撤回引用的那条消息，用被引用消息的 messageId', async () => {
    const s = await command(env, '撤回', '', { memberRole: 'member', quote: { messageId: 'MSG_1' } })
    expect(s.recalled).toEqual(['MSG_1'])
    expect(s.replies).toEqual([])
    expect(text(await command(env, '撤回'))).toBe('未引用要撤回的消息')
  })

  it('引用了但框架查不到消息 id：说明原因，把推送里引用相关的字段打进日志（不带原文和 auth_token）', async () => {
    const info = vi.spyOn(env.ctx.logger, 'info')
    const raw = {
      message_type: 103,
      message_scene: { ext: ['msg_idx=REFIDX_self', 'ref_msg_idx=REFIDX_q', 'auth_token=secret'] },
      msg_elements: [{ msg_idx: 'REFIDX_q', content: '原文' }],
    }
    const s = await command(env, '撤回', '', { quote: { messageId: '', refIndex: 'REFIDX_q' }, raw })
    expect(text(s)).toBe('只能撤回 2 分钟内、机器人收到过的消息')
    expect(s.recalled).toEqual([])
    expect(info).toHaveBeenCalledWith('群管撤回没拿到被引用消息的 id', {
      messageType: 103,
      ext: ['msg_idx=REFIDX_self', 'ref_msg_idx=REFIDX_q'],
      messageReference: undefined,
      element: { keys: ['msg_idx', 'content'], msgIdx: 'REFIDX_q', id: undefined },
    })
  })
})

describe('设置类命令', () => {
  it('刷屏禁言改的是刷屏时长（上游改成了禁词时长）', async () => {
    expect(text(await command(env, '刷屏禁言', '120'))).toBe('本群刷屏禁言时长已设为：120 秒')
    const { config } = await loadGroup(env.db, G)
    expect(config.spamming_ban_time).toBe(120)
    expect(config.word_ban_time).toBe(360)
  })

  it('开关命令不带参数是查看，不会被写成关（上游的 bug）', async () => {
    expect(text(await command(env, '进群审核'))).toBe('本群进群审核：开')
    expect((await loadGroup(env.db, G)).config.join_switch).toBe(true)
    expect(text(await command(env, '进群审核', '关'))).toBe('本群进群审核：关')
    expect((await loadGroup(env.db, G)).config.join_switch).toBe(false)
  })

  it('设置禁词：整表覆写、+- 增删、查看', async () => {
    expect(text(await command(env, '设置禁词', 'a b'))).toBe('本群违禁词已覆写为：a b')
    expect(text(await command(env, '禁词', '+c -a +b'))).toBe('本群违禁词\n新增：c\n移除：a')
    expect(text(await command(env, '违禁词'))).toBe("本群违禁词：['b', 'c']")
  })

  it('进群黑名单：+@ -@ 增删，也认 openid；不带符号整表覆写', async () => {
    const X = 'ABCDEF0123456789ABCDEF0123456789'
    const add = await command(env, '进群黑名单', `+ +${X}`, {
      mentions: [{ id: 'U1', username: '', bot: false }],
      raw: { content: `<@BOT> /进群黑名单 +<@U1> +${X}` },
    })
    expect(text(add)).toBe(`本群进群黑名单\n新增：U1、${X}`)
    const del = await command(env, '进群黑名单', '-', { mentions: [{ id: 'U1', username: '', bot: false }], raw: { content: '/进群黑名单 -<@U1>' } })
    expect(text(del)).toBe('本群进群黑名单\n移除：U1')
    expect(text(await command(env, '进群黑名单', '', at('U2', 'U3')))).toBe('黑名单已覆写为：U2 U3')
    expect(text(await command(env, '进群黑名单'))).toBe("本群进群黑名单：['U2', 'U3']")
  })

  it('群管配置：查看与修改；群管重置 all 只有超管能用', async () => {
    expect(text(await command(env, '群管配置'))).toContain('【群管配置】\n进群审核: 开')
    const s = await command(env, '群管配置', '进群审核: 关\n禁词禁言时长: 5')
    expect(text(s)).toContain('进群审核: 关')
    expect((await loadGroup(env.db, G)).config.word_ban_time).toBe(5)

    expect(text(await command(env, '群管重置', 'all'))).toBe('你没超管权限')
    expect(text(await command(env, '群管重置'))).toBe('已重置本群的群管配置')
    expect((await loadGroup(env.db, G)).follow).toBe(true)
    expect(text(await command(env, '群管重置', 'all', { isBotAdmin: true }))).toBe('已重置所有群的群管配置')
  })
})
