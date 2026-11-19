#!/usr/bin/env node
// 静态自检：claim.js 里用到的每个元素 id 都要在 claim.html 里存在，
// 并且页面引用的每个模块都要和 dist 里实际产出的文件对得上。

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '..', 'src')

const html = await readFile(join(src, 'claim.html'), 'utf8')
const js = await readFile(join(src, 'claim.js'), 'utf8')

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]))
const used = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]))

const missing = [...used].filter((id) => !ids.has(id))
const unused = [...ids].filter((id) => !used.has(id) && id !== 'viewer-img')

console.log(`html 里 ${ids.size} 个 id，claim.js 用了 ${used.size} 个`)
if (missing.length) console.log(`缺失的 id：${missing.join(', ')}`)
else console.log('OK：claim.js 用到的 id 全部存在')

if (unused.length) console.log(`提示：未被 claim.js 直接引用的 id：${unused.join(', ')}`)

const imports = [...js.matchAll(/from '\.\/([^']+)'/g)].map((match) => match[1])
const containerImports = []
for (const file of ['shared.mjs', 'container.mjs', 'zip.mjs']) {
  const text = await readFile(join(src, file), 'utf8')
  for (const match of text.matchAll(/from '\.\/([^']+)'/g)) containerImports.push(match[1])
}
const needed = new Set([...imports, ...containerImports])
const present = new Set(await readdir(src))
const absent = [...needed].filter((file) => !present.has(file))
console.log(absent.length ? `缺失模块：${absent.join(', ')}` : `OK：${[...needed].join(' / ')} 都在 src 里`)
process.exit(missing.length || absent.length ? 1 : 0)
