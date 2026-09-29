/**
 * 群管配置的字段定义：管理页面据此渲染表单，保存与「群管配置」命令据此校验。
 * 标签与提示照搬上游 _conf_schema.json，只改了平台没有的东西（QQ 号、QQ 等级、本地文件路径）。
 * 这个文件不引运行时，页面构建时也类型引用它。
 */

export type PermName = '超管' | '群主' | '管理员' | '成员'
export const PERM_NAMES: readonly PermName[] = ['超管', '群主', '管理员', '成员']

export type PermKey =
  | 'set_config'
  | 'reset_config'
  | 'set_group_ban'
  | 'cancel_group_ban'
  | 'delete_msg'
  | 'word_ban'
  | 'spamming'
  | 'vote'
  | 'join'
  | 'approve'
  | 'welcome'
  | 'leave'

export interface GroupConfig {
  join_switch: boolean
  join_max_time: number
  join_accept_words: string[]
  join_reject_words: string[]
  join_no_match_reject: boolean
  reject_word_block: boolean
  block_ids: string[]
  join_welcome: string
  join_ban_time: number
  leave_notify: boolean
  leave_block: boolean
  builtin_ban: boolean
  custom_ban_words: string[]
  word_ban_time: number
  spamming_ban_time: number
  admin_audit: boolean
  random_ban_time: string
  vote_ban: { ttl: number; threshold: number }
  perms: Record<PermKey, PermName>
}

interface FieldBase {
  /** 配置里的路径，嵌套的用点号：`vote_ban.ttl`、`perms.set_config` */
  key: string
  label: string
  hint?: string
}

export type FieldDef =
  | (FieldBase & { type: 'bool' })
  | (FieldBase & { type: 'int'; min: number; max: number; step?: number })
  | (FieldBase & { type: 'string'; multiline?: boolean })
  | (FieldBase & { type: 'list'; placeholder?: string })
  | (FieldBase & { type: 'select'; options: readonly string[] })

export interface SectionDef {
  title: string
  hint?: string
  /** 默认折叠（上游的指令权限管理） */
  collapsed?: boolean
  fields: FieldDef[]
}

/** 禁言最长 30 天（平台上限） */
export const MAX_BAN_SECONDS = 2592000

const PERM_FIELDS: Array<{ key: PermKey; label: string; hint?: string; default: PermName }> = [
  { key: 'set_config', label: '群管配置', default: '管理员' },
  { key: 'reset_config', label: '群管重置', default: '管理员' },
  { key: 'set_group_ban', label: '禁言', default: '管理员' },
  { key: 'cancel_group_ban', label: '解禁', default: '管理员' },
  { key: 'delete_msg', label: '撤回', default: '成员' },
  { key: 'word_ban', label: '禁词指令', hint: '包括：禁词禁言 <时长>、设置禁词、内置禁词 <开 | 关>', default: '管理员' },
  { key: 'spamming', label: '刷屏禁言指令', hint: '包括：刷屏禁言', default: '管理员' },
  { key: 'vote', label: '投票禁言指令', hint: '包括 投票禁言、赞同禁言、反对禁言', default: '成员' },
  {
    key: 'join',
    label: '进群审核指令',
    hint: '进群审核相关功能包括：进群审核开关、进群白词、进群黑词、进群尝试次数、未命中白词自动拒绝、命中黑词拉黑、进群黑名单',
    default: '管理员',
  },
  // 上游默认「高等级成员」，要看群等级，这边拿不到，改成管理员
  { key: 'approve', label: '批准/驳回（进群申请）', default: '管理员' },
  { key: 'welcome', label: '进群欢迎与禁言', default: '管理员' },
  { key: 'leave', label: '退群通知与拉黑', default: '管理员' },
]

export const SECTIONS: SectionDef[] = [
  {
    title: '进群审核',
    fields: [
      {
        key: 'join_switch',
        label: '进群审核',
        hint: '开启后，进群退群模块的功能才会在当前群聊生效，群主、群管理可用命令 “进群审核 开/关” 为当前群聊设置',
        type: 'bool',
      },
      {
        key: 'join_accept_words',
        label: '进群白词',
        hint: '用户申请加群时, 若进群答案中包含这些关键词，则自动通过申请',
        type: 'list',
      },
      {
        key: 'join_reject_words',
        label: '进群黑词',
        hint: '用户申请加群时, 若进群答案中包含这些关键词，则自动拒绝申请',
        type: 'list',
      },
      {
        key: 'join_no_match_reject',
        label: '自动拒绝未命中白词的进群申请',
        hint: '当用户申请加群时，没命中进群关键词，则自动驳回申请',
        type: 'bool',
      },
      {
        key: 'reject_word_block',
        label: '命中进群黑词自动拉黑',
        hint: '当用户因触发进群黑词而被拒绝进群时，自动拉黑该用户',
        type: 'bool',
      },
      {
        key: 'join_max_time',
        label: '进群最大尝试次数',
        hint: '当用户申请进行的次数超过此值时，自动拒绝进群申请。可通过群内命令为当前群聊设置',
        type: 'int',
        min: 0,
        max: 100,
      },
      {
        key: 'block_ids',
        label: '进群黑名单',
        hint: '用户加入群聊时，若用户 openid 在黑名单中，则自动拒绝',
        type: 'list',
        placeholder: '成员 openid',
      },
      {
        key: 'admin_audit',
        label: '进群事件仅通知bot管理员',
        hint: '如果开启，则进群事件仅通知bot管理员，不再将通知发送在对应群聊',
        type: 'bool',
      },
    ],
  },
  {
    title: '进群与退群',
    fields: [
      {
        key: 'join_welcome',
        label: '进群欢迎词',
        hint: '发给新群友的欢迎词, 支持变量: {nickname}, 示例：欢迎{nickname}加入群聊',
        type: 'string',
        multiline: true,
      },
      { key: 'join_ban_time', label: '进群禁言时长', hint: '单位为秒，新成员进群时，自动禁言该成员', type: 'int', min: 0, max: MAX_BAN_SECONDS },
      { key: 'leave_notify', label: '主动退群通知', hint: '当用户主动退群时，向群内通报', type: 'bool' },
      { key: 'leave_block', label: '主动退群拉黑', hint: '当用户主动退群时，自动拉黑（即添加到进群黑名单）', type: 'bool' },
    ],
  },
  {
    title: '违禁词与刷屏',
    fields: [
      {
        key: 'builtin_ban',
        label: '启用内置禁词',
        hint: '插件内置了一个敏感词库（源码里的 src/lexicon.json）, 不建议开启，让群管理员通过命令“ 内置禁词 开/关 ”来为当前群聊设置',
        type: 'bool',
      },
      { key: 'custom_ban_words', label: '群内自定义的违禁词', type: 'list' },
      {
        key: 'word_ban_time',
        label: '触发禁词时的禁言时长',
        hint: '触发违禁词则禁言发送者，单位：秒，设置为 0 表示不禁言',
        type: 'int',
        min: 0,
        max: MAX_BAN_SECONDS,
      },
      {
        key: 'spamming_ban_time',
        label: '刷屏禁言时长（秒）',
        hint: '当用户刷屏时触发禁言该用户，设置为 0 表示不启用此功能',
        type: 'int',
        min: 0,
        max: MAX_BAN_SECONDS,
      },
    ],
  },
  {
    title: '禁言',
    fields: [
      {
        key: 'random_ban_time',
        label: '随机禁言配置',
        hint: '若禁言命令未指定禁言时长，则使用随机时长，时长范围如下，单位为秒，用~表示范围',
        type: 'string',
      },
      {
        key: 'vote_ban.ttl',
        label: '投票时长（秒）',
        hint: '每轮投票时长到达此值时，开始结算，赞同票多于反对票时，禁言生效',
        type: 'int',
        min: 60,
        max: 300,
        step: 60,
      },
      {
        key: 'vote_ban.threshold',
        label: '投票通过所需票数',
        hint: '赞同禁言的投票数到达此值时，禁言直接生效',
        type: 'int',
        min: 2,
        max: 10,
      },
    ],
  },
  {
    title: '指令权限管理',
    hint: '设置各个命令的使用权限',
    collapsed: true,
    fields: PERM_FIELDS.map((p) => ({
      key: `perms.${p.key}`,
      label: p.label,
      ...(p.hint ? { hint: p.hint } : {}),
      type: 'select' as const,
      options: PERM_NAMES,
    })),
  },
]

export const DEFAULT_CONFIG: GroupConfig = {
  join_switch: true,
  join_max_time: 3,
  join_accept_words: ['白词1', '白词2'],
  join_reject_words: ['黑词1', '黑词2'],
  join_no_match_reject: false,
  reject_word_block: false,
  block_ids: [],
  join_welcome: '',
  join_ban_time: 0,
  leave_notify: false,
  leave_block: false,
  builtin_ban: false,
  custom_ban_words: ['禁词1', '禁词2'],
  word_ban_time: 360,
  spamming_ban_time: 0,
  admin_audit: false,
  random_ban_time: '30~300',
  vote_ban: { ttl: 120, threshold: 3 },
  perms: Object.fromEntries(PERM_FIELDS.map((p) => [p.key, p.default])) as Record<PermKey, PermName>,
}

/** 「群管配置」命令里的中文键名（上游 FIELD_MAP，去掉了拿不到的进群等级门槛） */
export const CN_NAMES: Record<string, string> = {
  join_switch: '进群审核',
  join_max_time: '进群尝试次数',
  join_accept_words: '进群白词',
  join_reject_words: '进群黑词',
  join_no_match_reject: '未中白词拒绝',
  reject_word_block: '命中黑词拉黑',
  block_ids: '进群黑名单',
  join_welcome: '进群欢迎词',
  join_ban_time: '进群禁言时长',
  leave_notify: '主动退群通知',
  leave_block: '主动退群拉黑',
  builtin_ban: '启用内置禁词',
  custom_ban_words: '自定义违禁词',
  word_ban_time: '禁词禁言时长',
  spamming_ban_time: '刷屏禁言时长',
}

export const ALL_FIELDS: FieldDef[] = SECTIONS.flatMap((s) => s.fields)
