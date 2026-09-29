import type { FieldDef, SectionDef } from '../src/fields.js'
import { h } from './dom.js'
import { type Control, controlFor } from './inputs.js'

type Obj = Record<string, unknown>

const getPath = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((cur, part) => (cur && typeof cur === 'object' ? (cur as Obj)[part] : undefined), obj)

function setPath(obj: Obj, path: string, value: unknown): void {
  const parts = path.split('.')
  let cur = obj
  for (const part of parts.slice(0, -1)) cur = (cur[part] ??= {}) as Obj
  cur[parts[parts.length - 1]!] = value
}

export interface FormHandle {
  collect(): Obj
}

function fieldRow(field: FieldDef, control: Control): HTMLElement {
  const block = field.type === 'list' || (field.type === 'string' && field.multiline)
  return h('div', { class: block ? 'field field-block' : 'field' }, [
    h('div', { class: 'field-copy' }, [
      h('div', { class: 'field-label', text: field.label }),
      field.hint ? h('p', { class: 'field-hint', text: field.hint }) : null,
    ]),
    h('div', { class: 'field-control' }, [control.el]),
  ])
}

/** 按字段定义渲染一组卡片；disabled 时（跟随默认配置）全部置灰 */
export function renderForm(root: HTMLElement, sections: SectionDef[], values: unknown, disabled: boolean): FormHandle {
  const controls: Array<[string, Control]> = []
  const cards = sections.map((section) => {
    const rows = section.fields.map((field) => {
      const control = controlFor(field, getPath(values, field.key))
      control.setDisabled(disabled)
      controls.push([field.key, control])
      return fieldRow(field, control)
    })
    const hint = section.hint ? h('p', { class: 'section-hint', text: section.hint }) : null
    const body = h('div', { class: 'fields' }, rows)
    // 指令权限管理默认折叠（上游同样）
    if (section.collapsed) {
      return h('details', { class: 'qb-card section' }, [
        h('summary', { class: 'section-summary' }, [h('span', { class: 'section-title', text: section.title }), hint]),
        body,
      ])
    }
    return h('section', { class: 'qb-card section' }, [h('h2', { class: 'section-title', text: section.title }), hint, body])
  })
  root.replaceChildren(...cards)
  return {
    collect() {
      const out: Obj = {}
      for (const [key, control] of controls) setPath(out, key, control.get())
      return out
    },
  }
}
