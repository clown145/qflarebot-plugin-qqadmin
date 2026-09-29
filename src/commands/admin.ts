import type { Command } from '@qqbot/sdk'
import { exportCnLines, importCnLines } from '../config.js'
import { guarded } from '../guard.js'
import { followDefault, resetAllGroups, saveGroup } from '../store/groups.js'

const G = ['group' as const]

const HELP = `【群管帮助】（群里 @机器人 时可以不打 /）
禁言 <秒数> @群友 ｜ 解禁 @群友
（引用消息）撤回
设置禁词 <词1 词2...>（+词 -词 增删）｜ 内置禁词 开/关
禁词禁言 <秒数> ｜ 刷屏禁言 <秒数>
投票禁言 <秒数> @群友 ｜ 赞同禁言 ｜ 反对禁言
进群审核 开/关 ｜ 进群白词 <词...> ｜ 进群黑词 <词...>
未命中驳回 开/关 ｜ 进群次数 <次数>
进群黑名单 +@群友 -@群友
（引用进群申请）批准 ｜ 驳回 <理由>
进群欢迎 <欢迎语> ｜ 进群禁言 <秒数>
退群通知 开/关 ｜ 退群拉黑 开/关
群管配置 <配置串> ｜ 群管重置 <all>
不带参数就是查看当前设置；更多设置在面板的插件页面「群管配置」里改`

export const adminCommands: Record<string, Command> = {
  群管配置: {
    aliases: ['群管设置'],
    usage: '/群管配置 或 /群管配置 <中文键: 值，每行一项>',
    description: '查看或修改本群群管配置',
    panelOnlyAdmin: true,
    scenes: G,
    // 上游还能写「群管配置 <群号> <配置串>」改别的群，这边没有群号，别的群到管理页面里改
    handler: guarded('set_config', async ({ ctx, argText, group }) => {
      if (!argText) return `【群管配置】\n${exportCnLines(group.config)}`
      const next = importCnLines(group.config, argText)
      await saveGroup(ctx.db, group.id, next)
      return `【群管配置】更新:\n${exportCnLines(next)}`
    }),
  },

  群管重置: {
    usage: '/群管重置 或 /群管重置 all',
    description: '本群恢复跟随默认配置',
    panelOnlyAdmin: true,
    scenes: G,
    handler: guarded('reset_config', async ({ ctx, session, args, group }) => {
      if (args[0] === 'all') {
        // 上游不是超管时会去重置一个叫 all 的群，却回「已重置本群」
        if (!session.isBotAdmin) return '你没超管权限'
        await resetAllGroups(ctx.db)
        return '已重置所有群的群管配置'
      }
      await followDefault(ctx.db, group.id)
      return '已重置本群的群管配置'
    }),
  },

  // 上游 README 里写了「发送 /群管帮助 查看用法」，代码里却没有这条命令
  群管帮助: {
    description: '群管插件的全部指令',
    scenes: G,
    handler: () => HELP,
  },
}
