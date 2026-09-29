type Props = Record<string, string | number | boolean | undefined | ((e: Event) => void)>

/** 建元素：文字一律走 textContent，不拼 innerHTML（群名、违禁词都是外部来的） */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: Array<Node | string | null | undefined> = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue
    if (typeof value === 'function') el.addEventListener(key.replace(/^on/, '').toLowerCase(), value)
    else if (key === 'class') el.className = String(value)
    else if (key === 'text') el.textContent = String(value)
    else if (value === true) el.setAttribute(key, '')
    else el.setAttribute(key, String(value))
  }
  for (const child of children) if (child !== null && child !== undefined) el.append(child)
  return el
}
