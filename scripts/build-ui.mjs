// 把 ui/ 下的管理页面打成单个 HTML，写进 src/web/page.generated.ts，随源码提交。
// 构建机不跑前端构建，页面又只能是单个文件（桥接令牌只在第一个请求里，页面再去加载的脚本带不上它），
// 所以脚本和样式都内联。改了 ui/ 之后跑 npm run build:ui（npm run sync 也会跑）
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build, transform } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const bundle = await build({
  absWorkingDir: root,
  entryPoints: ['ui/main.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
  // 面板提供，运行时从机器人域名加载；源码里写成 panel-bridge（见 ui/bridge.d.ts）
  alias: { 'panel-bridge': '/bridge.js' },
  external: ['/bridge.js'],
})
const script = bundle.outputFiles[0].text.trim().replaceAll('</script', '<\\/script')
const style = (await transform(await read('ui/styles.css'), { loader: 'css', minify: true })).code.trim()

// 用函数替换：脚本里的 $& 之类不会被当成替换模式
const html = (await read('ui/index.html')).replace('/*STYLE*/', () => style).replace('/*SCRIPT*/', () => script)

const out = `// 由 scripts/build-ui.mjs 从 ui/ 生成，不要手改；改页面后运行 npm run build:ui
export const PAGE_HTML = ${JSON.stringify(html)}
`
await writeFile(new URL('../src/web/page.generated.ts', import.meta.url), out)
console.log(`src/web/page.generated.ts ${(out.length / 1024).toFixed(1)} KB`)
