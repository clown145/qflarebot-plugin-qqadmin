import { definePlugin } from '@qqbot/sdk'
import { adminCommands } from './commands/admin.js'
import { approveButtons, approveCommands } from './commands/approve.js'
import { banCommands } from './commands/ban.js'
import { banwordCommands } from './commands/banwords.js'
import { joinCommands } from './commands/join.js'
import { settleExpiredVotes, voteCommands } from './commands/vote.js'
import { onMemberAdded, onMemberRemoved, onRobotAdded, onRobotRemoved } from './members.js'
import { moderate } from './moderation.js'
import { onJoinRequest } from './review.js'
import { pruneJoinFails } from './store/fails.js'
import { initSchema } from './store/schema.js'
import { routes } from './web/routes.js'

const DAY = 24 * 3600 * 1000

export default definePlugin({
  name: 'qqadmin',
  // mentionedUsers()、ctx.botAdmins 是契约 3 才有的（机器人 0.5.0 起）
  apiVersion: 3,
  displayName: 'QQ群管',
  description: '群管插件：禁言、撤回、违禁词、刷屏检测、投票禁言、进群审核与欢迎、退群通知，每个群可以单独配置',
  permissions: ['db', 'group_manage', 'recall', 'proactive'],
  ui: { path: '/ui/', title: '群管配置', icon: 'shield' },

  hooks: {
    async onInstall(ctx) {
      await initSchema(ctx.db)
    },
  },

  commands: {
    ...adminCommands,
    ...banCommands,
    ...banwordCommands,
    ...voteCommands,
    ...joinCommands,
    ...approveCommands,
  },

  buttons: approveButtons,

  events: {
    // 违禁词、刷屏：每条群消息都看一眼，只读内存里缓存的设置。
    //
    // **priority 必须比命令高**：框架在同 priority 时让命令排在事件前面，命令默认
    // `block: true`，命中后事件就不再跑了。不加这一条的话，`/weather 傻逼`、
    // `/签到 你妈的` 这类「命令 + 违禁词」消息会被漏检——群管要的是脏话一律拦下，
    // 不管它长什么样。事件默认 priority 是 0，所以给个正数就够了。
    'qq.group.message': { priority: 10, handler: moderate },
    'qq.group.at_message': { priority: 10, handler: moderate },
    'qq.group.join_request': onJoinRequest,
    'qq.group.member_added': onMemberAdded,
    'qq.group.member_removed': onMemberRemoved,
    'qq.group.robot_added': onRobotAdded,
    'qq.group.robot_removed': onRobotRemoved,
  },

  cron: {
    // 投票到点结算；没有进行中的投票时只是一次空查询
    votes: { cron: '* * * * *', handler: ({ ctx }) => settleExpiredVotes(ctx) },
    // 北京时间每天 04:17 清掉 30 天没再申请的入群失败记录
    prune: {
      cron: '17 20 * * *',
      async handler({ ctx }) {
        const removed = await pruneJoinFails(ctx.db, Date.now() - 30 * DAY)
        if (removed) ctx.logger.info('群管清理入群失败记录', { removed })
      },
    },
  },

  routes,
})
