#!/usr/bin/env node
// 本地自检：模拟学生打开页面并解密，确认某个学号能解开、错的解不开。
//
//   node src/check.mjs --dist dist --sid 2026C001 --factor 张倚晗

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { normalizeSid, normalizeFactor, recordId, decryptBytes, secretOf, ITERATIONS } from './shared.mjs'
import { unpack } from './container.mjs'

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
  console.log('用法：node src/check.mjs --dist <dist 目录> --sid <学号> [--factor <姓名或手机后4位>]')
  process.exit(1)
}

const dist = resolve(String(args.dist))
const configPath = join(dist, 'config.json')
if (!existsSync(configPath)) {
  console.error(`找不到 ${configPath}`)
  process.exit(1)
}

const config = JSON.parse(await readFile(configPath, 'utf8'))
const mode = config.secondFactor ?? 'none'
const sid = normalizeSid(args.sid)
const factor = mode === 'none' ? '' : normalizeFactor(args.factor ?? '', mode)

if (mode !== 'none' && !factor) {
  console.error(`这个页面需要第二因子（${config.secondLabel}），请加 --factor。`)
  process.exit(1)
}

const id = await recordId(sid, factor, config.pepper ?? '')
const file = join(dist, 'data', `${id}.bin`)
if (!existsSync(file)) {
  const files = await readdir(join(dist, 'data'))
  console.log(`未找到：${sid} → ${id}.bin（目录里共 ${files.length} 份）`)
  process.exit(2)
}

try {
  const encrypted = new Uint8Array(await readFile(file))
  const plain = await decryptBytes(encrypted, secretOf(sid, factor, config.pepper ?? ''), config.iterations ?? ITERATIONS)
  const { name, pages } = unpack(plain)
  console.log(`解密成功：${name}，共 ${pages.length} 页`)
  for (const page of pages) console.log(`  ${page.name}\t${page.mime}\t${(page.data.length / 1024).toFixed(0)} KB`)
} catch (error) {
  console.log(`文件存在但密钥不对：${error?.message ?? error}`)
  process.exit(3)
}
