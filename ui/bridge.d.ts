/**
 * 面板提供的 /bridge.js（@qqbot/ui-bridge），只声明页面用到的部分。
 * TypeScript 不让 `/…` 这种路径匹配声明，源码里写成 panel-bridge，scripts/build-ui.mjs 打包时换回 /bridge.js
 */
declare module 'panel-bridge' {
  export type Theme = 'light' | 'dark'
  export interface Bridge {
    readonly embedded: boolean
    readonly theme: Theme
    fetch(input: string, init?: RequestInit): Promise<Response>
    onTheme(handler: (theme: Theme) => void): () => void
    toast(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void
    setTitle(title: string): void
    resize(height?: number): void
  }
  export function createBridge(options?: { timeout?: number; applyTheme?: boolean }): Promise<Bridge>
}
