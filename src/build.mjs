#!/usr/bin/env node
// 把「按人分的扫描件 + 名单」编译成一个静态领取站：dist/
//
//   node src/build.mjs --source "C:\...\试卷" --roster roster.csv --out dist \
//        --title "创新班期中试卷领取" --subtitle "2026 级中科大交流生" --second name
//
// 每个学生的整套试卷打包成一个容器，用「学号 + 第二因子」派生的密钥整体加密，
// 公开目录里只有哈希命名的密文文件，没有姓名、没有学号、没有明文图片。

import { mkdir, readdir, readFile, writeFile, copyFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { extname, join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { csvObjects } from './csv.mjs'
import { normalizeSid, normalizeFactor, recordId, encryptBytes, secretOf, ITERATIONS } from './shared.mjs'
import { pack, unpack } from './container.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
}

const SECOND_LABEL = { name: '姓名', phone4: '手机号后 4 位' }
const MODES = new Set(['none', 'name', 'phone4'])
const MODULE_ASSETS = {
  'shared.mjs': 'shared.js',
  'container.mjs': 'container.js',
  'zip.mjs': 'zip.js',
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i += 1
    } else {
      out[key] = true
    }
  }
  return out
}

function fail(message) {
  console.error(`\n[build] ${message}\n`)
  process.exit(1)
}

const normName = (value) => String(value ?? '').replace(/\s/g, '')

/** 同姓、同长度、只差一个字：用来兜住名单与文件夹之间的错别字。 */
function oneEditApart(a, b) {
  const left = Array.from(a)
  const right = Array.from(b)
  if (left.length !== right.length || left.length === 0) return false
  if (left[0] !== right[0]) return false
  let diff = 0
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) diff += 1
  return diff <= 1
}

export async function build(options) {
  const { sourceDir, rosterPath, outDir, title, subtitle, note, second, order, iterations } = options

  if (!existsSync(sourceDir)) fail(`找不到文件夹 ${sourceDir}`)
  if (!existsSync(rosterPath)) fail(`找不到名单 ${rosterPath}`)

  const roster = csvObjects(await readFile(rosterPath, 'utf8'))
    .map((row) => ({ ...row, sid: normalizeSid(row.sid), name: (row.name ?? '').trim() }))
    .filter((row) => row.sid)
  if (roster.length === 0) fail('名单里没有学号（需要表头 学号 / sid）。')

  const byName = new Map()
  for (const row of roster) {
    const key = normName(row.name)
    if (!key) continue
    if (byName.has(key)) console.warn(`[build] 名单里姓名重复：${row.name}（${byName.get(key).sid} / ${row.sid}）`)
    byName.set(key, row)
  }

  const folders = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  if (folders.length === 0) fail(`${sourceDir} 下没有子文件夹（每个学生应有一个以姓名命名的文件夹）。`)

  // 先精确配对，再对错别字做唯一候选兜底；任何兜底都要在结果里说出来。
  const warnings = []
  const claimed = new Set()
  const plan = []
  const pending = []
  for (const folder of folders) {
    const row = byName.get(normName(folder))
    if (row) {
      plan.push({ folder, row })
      claimed.add(row.sid)
    } else {
      pending.push(folder)
    }
  }
  for (const folder of pending) {
    const candidates = roster.filter(
      (row) => !claimed.has(row.sid) && oneEditApart(normName(folder), normName(row.name)),
    )
    if (candidates.length === 1) {
      plan.push({ folder, row: candidates[0], fuzzy: true })
      claimed.add(candidates[0].sid)
      warnings.push(`文件夹「${folder}」与名单「${candidates[0].name}」只差一个字，已按同一人处理，页面同时接受两种写法；建议改正其中一处。`)
    } else {
      warnings.push(`文件夹「${folder}」在名单里找不到同名同学，已跳过。`)
    }
  }

  const pepper = randomBytes(16).toString('hex')
  const entries = []
  const dataDir = join(outDir, 'data')
  const usedSid = new Set()
  let totalBytes = 0

  await rm(outDir, { recursive: true, force: true })
  await mkdir(dataDir, { recursive: true })

  for (const entry of plan) {
    const { folder, row } = entry
    if (usedSid.has(row.sid)) {
      warnings.push(`学号 ${row.sid} 出现两次，后一个文件夹「${folder}」已跳过。`)
      continue
    }

    const folderPath = join(sourceDir, folder)
    const files = (await readdir(folderPath, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && MIME[extname(entry.name).toLowerCase()])
      .map((entry) => entry.name)
    if (files.length === 0) {
      warnings.push(`文件夹「${folder}」里没有图片/PDF，已跳过。`)
      continue
    }

    let ordered = files
    if (order === 'mtime') {
      const stamped = await Promise.all(files.map(async (file) => ({
        file,
        time: (await stat(join(folderPath, file))).mtimeMs,
      })))
      stamped.sort((a, b) => a.time - b.time || a.file.localeCompare(b.file))
      ordered = stamped.map((item) => item.file)
    } else {
      ordered = [...files].sort((a, b) => a.localeCompare(b))
    }

    const pages = []
    for (const [index, file] of ordered.entries()) {
      const ext = extname(file).toLowerCase()
      pages.push({
        name: `第${index + 1}张${ext}`,
        mime: MIME[ext],
        data: new Uint8Array(await readFile(join(folderPath, file))),
      })
    }

    const factor = second === 'name' ? normalizeFactor(row.name, 'name') : second === 'phone4' ? normalizeFactor(row.phone4, 'phone4') : ''
    if (second !== 'none' && !factor) {
      warnings.push(`学号 ${row.sid}（${row.name}）缺少「${SECOND_LABEL[second]}」，已跳过。`)
      continue
    }

    const container = pack(row.name || folder, pages)
    const secret = secretOf(row.sid, factor, pepper)
    const encrypted = await encryptBytes(container, secret, iterations)
    const id = await recordId(row.sid, factor, pepper)
    await writeFile(join(dataDir, `${id}.bin`), encrypted)

    // 姓名有两种写法时，两种都能解锁（同一份内容，各自用对应写法加密一次）。
    if (entry.fuzzy && second !== 'none') {
      const aliasFactor = normalizeFactor(folder, second)
      if (aliasFactor && aliasFactor !== factor) {
        const aliasId = await recordId(row.sid, aliasFactor, pepper)
        const aliasEncrypted = await encryptBytes(
          container,
          secretOf(row.sid, aliasFactor, pepper),
          iterations,
        )
        await writeFile(join(dataDir, `${aliasId}.bin`), aliasEncrypted)
        totalBytes += aliasEncrypted.length
      }
    }

    usedSid.add(row.sid)
    totalBytes += encrypted.length
    entries.push({ name: row.name || folder, sid: row.sid, pages: pages.length, bytes: encrypted.length, id })
  }

  if (entries.length === 0) fail('没有任何记录生成：检查文件夹名与名单姓名是否一致。')

  const config = {
    v: 2,
    title,
    subtitle,
    note,
    secondFactor: second,
    secondLabel: second === 'none' ? null : SECOND_LABEL[second],
    pepper,
    iterations,
    generatedAt: new Date().toISOString(),
    count: entries.length,
  }
  await writeFile(join(outDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)

  // 页面脚本统一用 .js 输出：GitHub Pages 对 .mjs 的 MIME 类型不保证，import 会被拦。
  for (const [from, to] of Object.entries(MODULE_ASSETS)) {
    const text = await readFile(join(pkgRoot, 'src', from), 'utf8')
    await writeFile(join(outDir, to), text.replaceAll('.mjs', '.js'))
  }
  await writeFile(
    join(outDir, 'claim.js'),
    (await readFile(join(pkgRoot, 'src', 'claim.js'), 'utf8')).replaceAll('.mjs', '.js'),
  )
  await copyFile(join(pkgRoot, 'src', 'claim.html'), join(outDir, 'index.html'))
  await writeFile(join(outDir, '.nojekyll'), '')

  for (const row of roster) {
    if (!usedSid.has(row.sid)) warnings.push(`名单里的 ${row.name}（${row.sid}）没有对应文件夹或没有图片。`)
  }

  return { entries, warnings, outDir, totalBytes, count: entries.length }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`用法：node src/build.mjs --source <试卷目录> [选项]

  --source <dir>     每个学生一个子文件夹（文件夹名 = 名单里的姓名）
  --roster <path>    名单 CSV，列：学号,姓名[,手机后4位]（默认 roster.csv）
  --out <dir>        输出目录，默认 docs（GitHub Pages 的发布目录）
  --title <text>     页面标题
  --subtitle <text>  副标题
  --note <text>      页脚说明
  --second <mode>    第二因子：none | name | phone4（默认 name）
  --order <mode>     页序：mtime（扫描顺序，默认）| name
  --iterations <n>   PBKDF2 迭代次数，默认 ${ITERATIONS}`)
    return
  }

  const second = String(args.second ?? 'name')
  if (!MODES.has(second)) fail(`--second 只能是 ${[...MODES].join(' / ')}`)
  const order = String(args.order ?? 'mtime')
  if (order !== 'mtime' && order !== 'name') fail('--order 只能是 mtime 或 name')

  const result = await build({
    sourceDir: resolve(String(args.source ?? '')),
    rosterPath: resolve(String(args.roster ?? 'roster.csv')),
    outDir: resolve(String(args.out ?? 'docs')),
    title: String(args.title ?? '期中试卷领取'),
    subtitle: String(args.subtitle ?? ''),
    note: String(args.note ?? ''),
    second,
    order,
    iterations: Number(args.iterations ?? ITERATIONS),
  })

  console.log(`\n[build] 生成 ${result.count} 份，加密后共 ${(result.totalBytes / 1048576).toFixed(1)} MB → ${result.outDir}`)
  for (const entry of result.entries) {
    console.log(`  ${entry.sid}\t${entry.name}\t${entry.pages} 张\t${(entry.bytes / 1024).toFixed(0)} KB`)
  }
  if (result.warnings.length) {
    console.log('\n[build] 需要注意：')
    for (const line of result.warnings) console.log(`  - ${line}`)
  }
  console.log('\n[build] 把 docs/ 整个上传到任意静态托管即可（GitHub Pages 见 README）；里面有姓名学号线索的只有密文。')
  console.log('[build] 本地预览：node tools/serve.mjs docs 5173  （直接双击 index.html 会因模块加载失败白屏）\n')
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => fail(error?.stack ?? String(error)))
}
