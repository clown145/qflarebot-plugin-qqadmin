import { createBridge } from 'panel-bridge'
import { createApi, type GroupEntry, type State } from './api.js'
import { h } from './dom.js'
import { type FormHandle, renderForm } from './form.js'
import { renderList } from './list.js'

const DEFAULT = '__default__'
/** 与 src/web/routes.ts 的 NAMES_PER_REQUEST 一致 */
const NAMES_PER_REQUEST = 40

const $ = (id: string) => document.getElementById(id)!
const bridge = await createBridge()
const api = createApi(bridge)
bridge.setTitle('群管配置')

let state: State = { sections: [], defaults: {} as State['defaults'], groups: [] }
const names: Record<string, string | null> = {}
let current = DEFAULT
let follow = false
let form: FormHandle | null = null
/** 载入时的表单内容，切换群时据此判断要不要先保存 */
let baseline = ''

const entry = (id: string): GroupEntry | undefined => state.groups.find((g) => g.id === id)
const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id)
const titleOf = (id: string) => (id === DEFAULT ? '默认群' : names[id] || `群 ${shortId(id)}`)
const snapshot = () => JSON.stringify({ follow, config: form?.collect() ?? null })
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

function showList(): void {
  const keyword = ($('search') as HTMLInputElement).value.trim().toLowerCase()
  const items = [
    { id: DEFAULT, title: '默认群', sub: '默认模板 · 新群继承这里的配置' },
    ...state.groups.map((g) => ({
      id: g.id,
      title: titleOf(g.id),
      sub: shortId(g.id),
      ...(g.follow ? {} : { badge: '独立配置' }),
    })),
  ].filter((i) => !keyword || i.id === DEFAULT || i.title.toLowerCase().includes(keyword) || i.id.toLowerCase().includes(keyword))
  $('count').textContent = `${state.groups.length} 个群`
  renderList($('list'), items, current, (id) => void select(id))
}

function followCard(): HTMLElement {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': '跟随默认配置' })
  input.checked = follow
  input.addEventListener('change', () => {
    follow = input.checked
    showForm()
  })
  return h('section', { class: 'qb-card section' }, [
    h('div', { class: 'field' }, [
      h('div', { class: 'field-copy' }, [
        h('div', { class: 'field-label', text: '跟随默认配置' }),
        h('p', { class: 'field-hint', text: '开启后，该群直接沿用默认群配置，下面的群专属配置项将不可编辑。' }),
      ]),
      h('div', { class: 'field-control' }, [h('span', { class: 'switch' }, [input, h('span', { class: 'switch-track', 'aria-hidden': 'true' })])]),
    ]),
  ])
}

function showForm(): void {
  const isDefault = current === DEFAULT
  const own = entry(current)
  const values = isDefault || follow || !own ? state.defaults : own.config
  const fields = h('div', { class: 'form' })
  $('form').replaceChildren(...(isDefault ? [] : [followCard()]), fields)
  form = renderForm(fields, state.sections, values, !isDefault && follow)
  showActions()
}

function showActions(): void {
  const isDefault = current === DEFAULT
  const save = h('button', { class: 'qb-btn qb-btn--primary', type: 'button', text: isDefault ? '保存默认群模板' : '保存当前项配置' })
  save.addEventListener('click', () => void run(save, () => saveCurrent(false)))
  const buttons: HTMLElement[] = [save]
  if (!isDefault) {
    const following = entry(current)?.follow ?? false
    const reset = h('button', { class: 'qb-btn', type: 'button', text: following ? '当前正在跟随默认配置' : '恢复当前项默认值' })
    reset.disabled = following
    reset.addEventListener('click', () => void run(reset, resetCurrent))
    buttons.push(reset, removeButton())
  }
  $('actions').replaceChildren(...buttons)
}

/** 从列表移除：页面里用不了 confirm()（sandbox 不给弹框），点两次确认 */
function removeButton(): HTMLElement {
  const btn = h('button', { class: 'qb-btn danger', type: 'button', text: '从列表移除' })
  let armed = false
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true
      btn.textContent = '再点一次确认移除'
      setTimeout(() => {
        armed = false
        btn.textContent = '从列表移除'
      }, 3000)
      return
    }
    void run(btn, removeCurrent)
  })
  return btn
}

async function run(btn: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
  btn.disabled = true
  try {
    await action()
  } catch (err) {
    bridge.toast(message(err), 'error')
  } finally {
    btn.disabled = false
  }
}

function showDetail(): void {
  $('title').textContent = titleOf(current)
  $('subtitle').textContent = current === DEFAULT ? '新群和跟随默认配置的群都用这里的设置' : current
  showForm()
  baseline = snapshot()
}

async function saveCurrent(silent: boolean): Promise<void> {
  if (!form) return
  const config = form.collect()
  if (current === DEFAULT) {
    const r = await api.saveDefault(config)
    state.defaults = r.config
    for (const g of state.groups) if (g.follow) g.config = r.config
  } else {
    const r = await api.saveGroup(current, follow, config)
    state.groups = state.groups.map((g) => (g.id === r.id ? r : g))
  }
  baseline = snapshot()
  if (!silent) bridge.toast(current === DEFAULT ? '默认群模板已保存' : `${titleOf(current)} 配置已保存`, 'success')
  showActions()
  showList()
}

async function resetCurrent(): Promise<void> {
  const r = await api.saveGroup(current, true, {})
  state.groups = state.groups.map((g) => (g.id === r.id ? r : g))
  follow = true
  showDetail()
  showList()
  bridge.toast(`${titleOf(current)} 已恢复默认群配置`, 'success')
}

async function removeCurrent(): Promise<void> {
  const id = current
  await api.removeGroup(id)
  state.groups = state.groups.filter((g) => g.id !== id)
  current = DEFAULT
  showDetail()
  showList()
  bridge.toast(`${titleOf(id)} 已从列表移除`, 'success')
}

/** 切换群时先把改动存下来（上游也是切换即保存） */
async function select(id: string): Promise<void> {
  if (id === current) return
  if (snapshot() !== baseline) {
    try {
      await saveCurrent(true)
    } catch (err) {
      bridge.toast(`保存失败，没有切换：${message(err)}`, 'error')
      return
    }
  }
  current = id
  follow = entry(id)?.follow ?? false
  showDetail()
  showList()
}

/** 群名不存库，每次打开页面分批现查 */
async function loadNames(): Promise<void> {
  const ids = state.groups.map((g) => g.id)
  for (let i = 0; i < ids.length; i += NAMES_PER_REQUEST) {
    const r = await api.names(ids.slice(i, i + NAMES_PER_REQUEST))
    Object.assign(names, r.names)
    showList()
    $('title').textContent = titleOf(current)
  }
}

async function init(): Promise<void> {
  $('search').addEventListener('input', showList)
  const refresh = $('refresh') as HTMLButtonElement
  refresh.addEventListener('click', () => void run(refresh, loadNames))
  try {
    state = await api.state()
  } catch (err) {
    $('form').replaceChildren(h('p', { class: 'qb-card empty', text: `读取配置失败：${message(err)}` }))
    return
  }
  showDetail()
  showList()
  bridge.resize()
  loadNames().catch((err) => bridge.toast(`读取群名失败：${message(err)}`, 'warning'))
}

void init()
