import type { Keyboard, OutgoingMessage } from '@qqbot/sdk'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadGroup, updateGroup } from '../src/store/groups.js'
import { ADMIN, calls, click, command, type Env, event, G, setup, text } from './helpers.js'

let env: Env
beforeEach(async () => {
  env = await setup()
})

const request = (answer: string, user = 'NEW1') =>
  event(env, 'qq.group.join_request', {
    userId: user,
    userName: '',
    messageId: null,
    raw: {
      group_openid: G,
      member_openid: user,
      join_request_id: `REQ_${user}`,
      username: '新人',
      verify_info: { review_qa_list: [{ question: '暗号', answer }] },
    },
  })

const reviews = () => calls(env, 'POST', 'approval_join_request').map((c) => [c.path.split('/').pop(), c.body])
const sent = () => calls(env, 'POST', 'send:').map((c) => ({ path: c.path, message: (c.body as { message: OutgoingMessage }).message }))
const edit = async (change: Parameters<typeof updateGroup>[2]) => updateGroup(env.db, await loadGroup(env.db, G), change)

describe('入群申请', () => {
  it('命中白词自动批准，群里发通知（不带按钮）', async () => {
    await edit((c) => void (c.join_accept_words = ['芝麻开门']))
    await request('我知道：芝麻开门')
    expect(reviews()).toEqual([['NEW1', { approve: true, join_request_id: 'REQ_NEW1' }]])
    const [notice] = sent()
    expect(notice!.path).toBe(`send:group:${G}`)
    expect(notice!.message).toBe('【进群申请】\n昵称：新人\nopenid：NEW1\nflag：REQ_NEW1\n问题：暗号\n答案：我知道：芝麻开门\n自动批准：命中进群白词')
  })

  it('黑名单直接驳回，不发通知；黑词驳回并按设置拉黑', async () => {
    await edit((c) => {
      c.block_ids = ['BAD']
      c.join_reject_words = ['广告']
      c.reject_word_block = true
    })
    await request('随便', 'BAD')
    expect(reviews()).toEqual([['BAD', { approve: false, reason: '黑名单用户', join_request_id: 'REQ_BAD' }]])
    expect(sent()).toEqual([])

    await request('我是来发广告的', 'AD')
    expect((await loadGroup(env.db, G)).config.block_ids).toEqual(['BAD', 'AD'])
    expect((sent()[0]!.message as string).endsWith('自动驳回：命中进群黑词，已拉黑')).toBe(true)
  })

  it('没命中就转人工：通知带批准/驳回按钮，默认只有管理员点得动', async () => {
    await request('不知道')
    const msg = sent()[0]!.message as { text: string; keyboard: Keyboard }
    expect(msg.text.startsWith('【进群申请】批准/驳回：\n昵称：新人')).toBe(true)
    const buttons = msg.keyboard.content!.rows[0]!.buttons
    expect(buttons.map((b) => [b.id, b.render_data.label, b.action.permission])).toEqual([
      ['join_approve', '批准', { type: 1 }],
      ['join_reject', '驳回', { type: 1 }],
    ])
    expect(JSON.parse(buttons[0]!.action.data!)).toEqual({ g: G, m: 'NEW1', f: 'REQ_NEW1', n: '新人' })
  })

  it('没命中的次数到上限就拉黑并驳回', async () => {
    await edit((c) => void (c.join_max_time = 2))
    await request('?')
    await request('?')
    expect(reviews().pop()).toEqual(['NEW1', { approve: false, reason: '进群尝试次数已达上限(2次)，已拉黑', join_request_id: 'REQ_NEW1' }])
    expect((await loadGroup(env.db, G)).config.block_ids).toEqual(['NEW1'])
  })

  it('进群审核关了不处理；开了「仅通知 bot 管理员」就私聊管理员', async () => {
    await edit((c) => void (c.join_switch = false))
    await request('?')
    expect(sent()).toEqual([])

    await edit((c) => {
      c.join_switch = true
      c.admin_audit = true
    })
    await request('?')
    expect(sent().map((s) => s.path)).toEqual([`send:c2c:${ADMIN}`])
  })
})

describe('批准与驳回', () => {
  const notice = '【进群申请】批准/驳回：\n昵称：新人\nopenid：NEW1\nflag：REQ_NEW1\n问题：暗号\n答案：?'

  it('引用通知发命令；驳回带理由', async () => {
    expect(text(await command(env, '批准', '', { quote: { content: notice } }))).toBe('已同意新人进群')
    expect(text(await command(env, '驳回', '答错了', { quote: { content: notice } }))).toBe('已拒绝新人进群\n理由：答错了')
    expect(reviews()).toEqual([
      ['NEW1', { approve: true, join_request_id: 'REQ_NEW1' }],
      ['NEW1', { approve: false, reason: '答错了', join_request_id: 'REQ_NEW1' }],
    ])
    expect(text(await command(env, '批准'))).toBe('未引用任何【进群申请】')
    expect(text(await command(env, '批准', '', { memberRole: 'member', quote: { content: notice } }))).toBe('你没管理员权限')
  })

  it('点按钮审批；门槛是超管时回调里再验 Bot 管理员', async () => {
    const data = JSON.stringify({ g: G, m: 'NEW1', f: 'REQ_NEW1', n: '新人' })
    expect(text((await click(env, 'join_reject', data)).session)).toBe('已拒绝新人进群')

    await edit((c) => void (c.perms.approve = '超管'))
    expect((await click(env, 'join_approve', data)).code).toBe(4)
    expect(text((await click(env, 'join_approve', data, { isBotAdmin: true })).session)).toBe('已同意新人进群')
    expect(text((await click(env, 'join_approve', 'garbage')).session)).toBe('这条申请处理过了或者格式不对')
  })
})

describe('成员变动', () => {
  it('进群欢迎（{nickname}）与进群禁言', async () => {
    await edit((c) => {
      c.join_welcome = '欢迎{nickname}加入群聊'
      c.join_ban_time = 60
    })
    await event(env, 'qq.group.member_added', { userId: 'NEW1', userName: '', messageId: null })
    expect(sent()).toEqual([{ path: `send:group:${G}`, message: '欢迎<@NEW1>加入群聊' }])
    expect(calls(env, 'POST', 'restrict_chat_setting')).toHaveLength(1)
  })

  it('主动退群：通报与拉黑各管各的；被踢的不算', async () => {
    await edit((c) => void (c.leave_block = true))
    await event(env, 'qq.group.member_removed', { userId: 'OLD1', userName: '老王', messageId: null, raw: { op_member_openid: 'OLD1' } })
    expect((await loadGroup(env.db, G)).config.block_ids).toEqual(['OLD1'])
    expect(sent()).toEqual([])

    await edit((c) => void (c.leave_notify = true))
    await event(env, 'qq.group.member_removed', { userId: 'KICKED', messageId: null, raw: { op_member_openid: 'SOMEADMIN' } })
    expect(sent()).toEqual([])
    await event(env, 'qq.group.member_removed', { userId: 'OLD2', userName: '小李', messageId: null, raw: {} })
    expect(sent()).toEqual([{ path: `send:group:${G}`, message: '小李(OLD2) 主动退群了，已拉黑' }])
  })

  it('机器人被移出群时清掉这个群', async () => {
    await edit((c) => void (c.builtin_ban = true))
    await event(env, 'qq.group.robot_removed', { messageId: null })
    expect(env.db.sqlite.prepare('SELECT COUNT(*) AS n FROM p_qqadmin_groups WHERE group_id = ?').get(G)).toEqual({ n: 0 })
  })
})
