import { h } from './dom.js'

export interface ListItem {
  id: string
  title: string
  sub: string
  badge?: string
}

/** 左侧群列表：没有群头像（官方接口不给群号，拼不出头像地址），用群名首字 */
export function renderList(root: HTMLElement, items: ListItem[], current: string, onSelect: (id: string) => void): void {
  if (!items.length) {
    root.replaceChildren(h('p', { class: 'empty', text: '没有匹配的群' }))
    return
  }
  root.replaceChildren(
    ...items.map((item) =>
      h(
        'button',
        {
          class: item.id === current ? 'group-item active' : 'group-item',
          type: 'button',
          'aria-current': item.id === current ? 'true' : undefined,
          onclick: () => onSelect(item.id),
        },
        [
          h('span', { class: 'avatar', 'aria-hidden': 'true', text: [...item.title][0] ?? '群' }),
          h('span', { class: 'group-main' }, [
            h('span', { class: 'group-title', text: item.title }),
            h('span', { class: 'group-sub', text: item.sub }),
          ]),
          item.badge ? h('span', { class: 'badge', text: item.badge }) : null,
        ],
      ),
    ),
  )
}
