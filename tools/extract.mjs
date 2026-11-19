#!/usr/bin/env node
// 把某个学生的试卷解密导出成本地文件（老师自己核对用）。
//
//   node tools/extract.mjs --dist dist --sid 2026C001 --factor 张倚晗 --out 导出

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { normalizeSid, normalizeFactor, recordId, decryptBytes, secretOf, ITERATIONS } from '../src/shared.mjs'
import { unpack } from '../src/container.mjs'

const argv = process.argv.slice(2)
const args = {}
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (!arg.startsWith('--')) continue
  const eq = arg.indexOf('=')
  if (eq !== -1) {
    args[arg.slice(2, eq)] = arg.slice(eq + 1)
    continue
  }
  const key = arg.slice(2)
  const next = argv[i + 1]
  if (next !== undefined && !next.startsWith('--')) {
    args[key] = next
    i += 1
  } else {
    args[key] = true
  }
}

if (!args.dist || !args.sid) {
  console.log('用法：node tools/extract.mjs --dist <dist> --sid <学号> [--factor <姓名/手机后4位>] [--out <目录>]')
  process.exit(1)
}

const dist = resolve(String(args.dist))
const config = JSON.parse(await readFile(join(dist, 'config.json'), 'utf8'))
const mode = config.secondFactor ?? 'none'
const sid = normalizeSid(args.sid)
const factor = mode === 'none' ? '' : normalizeFactor(args.factor ?? '', mode)

const id = await recordId(sid, factor, config.pepper ?? '')
const file = join(dist, 'data', `${id}.bin`)
if (!existsSync(file)) {
  console.error(`没有找到 ${sid} 的密文（学号或第二因子不对）。`)
  process.exit(2)
}

const encrypted = new Uint8Array(await readFile(file))
const plain = await decryptBytes(encrypted, secretOf(sid, factor, config.pepper ?? ''), config.iterations ?? ITERATIONS)
const { name, pages } = unpack(plain)

const outDir = resolve(String(args.out ?? `导出_${name}`))
await mkdir(outDir, { recursive: true })
for (const page of pages) {
  const target = join(outDir, `${name}_${page.name}`)
  await writeFile(target, page.data)
  console.log(target)
}
