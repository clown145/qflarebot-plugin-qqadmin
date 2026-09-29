import type { FieldDef } from '../src/fields.js'
import { h } from './dom.js'
import { listInput } from './list-input.js'

/** 一个表单控件：取值、禁用 */
export interface Control {
  el: HTMLElement
  get(): unknown
  setDisabled(disabled: boolean): void
}

function switchInput(value: unknown, label: string): Control {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label })
  input.checked = value === true
  const el = h('span', { class: 'switch' }, [input, h('span', { class: 'switch-track', 'aria-hidden': 'true' })])
  return { el, get: () => input.checked, setDisabled: (d) => void (input.disabled = d) }
}

function numberInput(field: Extract<FieldDef, { type: 'int' }>, value: unknown): Control {
  const input = h('input', {
    class: 'qb-input num',
    type: 'number',
    inputmode: 'numeric',
    min: field.min,
    max: field.max,
    step: field.step ?? 1,
    'aria-label': field.label,
  })
  input.value = String(value ?? '')
  return { el: input, get: () => Number(input.value), setDisabled: (d) => void (input.disabled = d) }
}

function textInput(field: Extract<FieldDef, { type: 'string' }>, value: unknown): Control {
  const input = field.multiline
    ? h('textarea', { class: 'qb-input area', rows: 3, 'aria-label': field.label })
    : h('input', { class: 'qb-input', type: 'text', 'aria-label': field.label })
  input.value = String(value ?? '')
  return { el: input, get: () => input.value, setDisabled: (d) => void (input.disabled = d) }
}

function selectInput(field: Extract<FieldDef, { type: 'select' }>, value: unknown): Control {
  const select = h(
    'select',
    { class: 'qb-input', 'aria-label': field.label },
    field.options.map((o) => h('option', { value: o, text: o })),
  )
  select.value = String(value ?? field.options[0] ?? '')
  return { el: select, get: () => select.value, setDisabled: (d) => void (select.disabled = d) }
}

export function controlFor(field: FieldDef, value: unknown): Control {
  switch (field.type) {
    case 'bool':
      return switchInput(value, field.label)
    case 'int':
      return numberInput(field, value)
    case 'string':
      return textInput(field, value)
    case 'select':
      return selectInput(field, value)
    case 'list':
      return listInput(field, value)
  }
}
