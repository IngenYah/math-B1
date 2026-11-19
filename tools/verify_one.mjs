#!/usr/bin/env node
// 交付校验：把某个学生的密文解开，和原始扫描件逐字节比对，确认发出去的就是原件。
//
//   node tools/verify_one.mjs --dist dist --source "C:\...\试卷\张倚晗" --sid 2026C001 --factor 张倚晗
//   node tools/verify_one.mjs --dist dist --source "..." --sid 2026C001 --factor 张倚晗 --zip out.zip

import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { normalizeSid, normalizeFactor, recordId, decryptBytes, secretOf, ITERATIONS } from '../src/shared.mjs'
import { unpack } from '../src/container.mjs'
import { createZip } from '../src/zip.mjs'

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

if (!args.dist || !args.source || !args.sid) {
  console.log('用法：node tools/verify_one.mjs --dist <dist> --source <该学生的原始文件夹> --sid <学号> [--factor <姓名或手机后4位>] [--zip <输出.zip>]')
  process.exit(1)
}

const dist = resolve(String(args.dist))
const source = resolve(String(args.source))
const config = JSON.parse(await readFile(join(dist, 'config.json'), 'utf8'))
const mode = config.secondFactor ?? 'none'
const sid = normalizeSid(args.sid)
const factor = mode === 'none' ? '' : normalizeFactor(args.factor ?? '', mode)

const id = await recordId(sid, factor, config.pepper ?? '')
const file = join(dist, 'data', `${id}.bin`)
if (!existsSync(file)) {
  console.error(`找不到密文 ${file}`)
  process.exit(2)
}

const encrypted = new Uint8Array(await readFile(file))
const plain = await decryptBytes(encrypted, secretOf(sid, factor, config.pepper ?? ''), config.iterations ?? ITERATIONS)
const { name, pages } = unpack(plain)

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

const originals = (await readdir(source, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => join(source, entry.name))
const originalHashes = await Promise.all(originals.map(async (path) => hash(await readFile(path))))
const deliveredHashes = pages.map((page) => hash(page.data))

const same = [...originalHashes].sort().join(',') === [...deliveredHashes].sort().join(',')

console.log(`学号 ${sid} → ${name}，${pages.length} 页`)
console.log(`原件 ${originals.length} 个文件，哈希${same ? '完全一致' : '不一致！'}`)
for (const [index, page] of pages.entries()) {
  console.log(`  ${page.name}\t${page.mime}\t${page.data.length} B\t${hash(page.data).slice(0, 12)}`)
}

if (args.zip) {
  const entries = pages.map((page, index) => ({
    name: `${name}_第${index + 1}页${extname(page.name) || '.jpg'}`,
    data: page.data,
  }))
  const zipPath = resolve(String(args.zip))
  await writeFile(zipPath, createZip(entries))
  console.log(`已写出 ${zipPath}`)
}

if (!same) {
  console.error('交付内容与原件不一致！')
  process.exit(3)
}
