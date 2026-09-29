import type { FieldDef } from '../src/fields.js'
import { h } from './dom.js'
import type { Control } from './inputs.js'

/**
 * 逐条输入的列表（面板里字符串列表的同一种写法）：一行一条，可删；
 * 粘贴多行文字时按行拆成多条
 */
export function listInput(field: Extract<FieldDef, { type: 'list' }>, value: unknown): Control {
  const items = h('div', { class: 'list-items' })
  const add = h('button', { class: 'qb-btn small', type: 'button', text: '添加一条' })
  const el = h('div', { class: 'list-input' }, [items, add])
  let disabled = false

  const inputs = () => [...items.querySelectorAll<HTMLInputElement>('input')]

  function row(text: string, focus = false): void {
    const input = h('input', { class: 'qb-input', type: 'text', placeholder: field.placeholder ?? '', 'aria-label': field.label })
    input.value = text
    input.disabled = disabled
    input.addEventListener('paste', (e) => {
      const pasted = e.clipboardData?.getData('text') ?? ''
      const lines = pasted.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      if (lines.length < 2) return
      e.preventDefault()
      input.value = lines[0]!
      for (const line of lines.slice(1)) row(line)
    })
    const remove = h('button', {
      class: 'qb-btn small ghost',
      type: 'button',
      text: '删除',
      'aria-label': `删除这一条${field.label}`,
      onclick: () => wrap.remove(),
    })
    remove.disabled = disabled
    const wrap = h('div', { class: 'list-row' }, [input, remove])
    items.append(wrap)
    if (focus) input.focus()
  }

  for (const text of Array.isArray(value) ? value : []) row(String(text))
  add.addEventListener('click', () => row('', true))

  return {
    el,
    get: () => inputs().map((i) => i.value.trim()).filter(Boolean),
    setDisabled(d) {
      disabled = d
      add.disabled = d
      for (const b of items.querySelectorAll('button')) b.disabled = d
      for (const i of inputs()) i.disabled = d
    },
  }
}
