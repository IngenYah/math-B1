import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  normalizeSid,
  normalizeFactor,
  recordId,
  encryptBytes,
  decryptBytes,
  secretOf,
} from '../src/shared.mjs'
import { pack, unpack } from '../src/container.mjs'
import { createZip, crc32 } from '../src/zip.mjs'
import { build } from '../src/build.mjs'

const dec = new TextDecoder()

function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  assert.notEqual(eocd, -1, '缺少 EOCD')
  const count = view.getUint16(eocd + 10, true)
  assert.equal(count, view.getUint16(eocd + 8, true), '两个目录项计数应一致')
  const cdOffset = view.getUint32(eocd + 16, true)
  const cdSize = view.getUint32(eocd + 12, true)
  assert.equal(cdOffset + cdSize, eocd, '中央目录应紧挨 EOCD')

  const entries = []
  let cursor = cdOffset
  for (let i = 0; i < count; i += 1) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50, '中央目录签名不对')
    const crc = view.getUint32(cursor + 16, true)
    const size = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = dec.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength))

    assert.equal(view.getUint32(localOffset, true), 0x04034b50, '局部文件头签名不对')
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const data = bytes.slice(start, start + size)

    entries.push({ name, crc, data, localName: dec.decode(bytes.slice(localOffset + 30, localOffset + 30 + localNameLength)) })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

test('学号归一化与记录键', async () => {
  assert.equal(normalizeSid(' 2026C001 '), '2026c001')
  assert.equal(normalizeSid('２０２６Ｃ００１'), '2026c001')
  assert.equal(normalizeFactor('张 三', 'name'), '张三')
  assert.equal(normalizeFactor('138-1234-8899', 'phone4'), '8899')

  const a = await recordId('2026C001', '张倚晗', 'p')
  const b = await recordId('2026C001', '张倚晗', 'p')
  const c = await recordId('2026C001', '黄博奥', 'p')
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.match(a, /^[0-9a-f]{32}$/)
})

test('字节加密往返，密钥不对打不开', async () => {
  const data = new Uint8Array([0, 1, 2, 250, 251, 252, 13, 10])
  const secret = secretOf('2026c001', '张倚晗', 'pepper')
  const encrypted = await encryptBytes(data, secret, 1000)
  assert.equal(encrypted.length, data.length + 28 + 16) // salt + iv + 密文 + GCM tag
  assert.notDeepEqual([...encrypted.slice(28)], [...data], '密文不应等于明文')

  const back = await decryptBytes(encrypted, secret, 1000)
  assert.deepEqual([...back], [...data])

  await assert.rejects(decryptBytes(encrypted, secretOf('2026c001', '黄博奥', 'pepper'), 1000))
})

test('容器打包与解包（含中文姓名和二进制页）', () => {
  const pages = [
    { name: '第1页.jpg', mime: 'image/jpeg', data: new Uint8Array([255, 216, 255, 224, 0, 16]) },
    { name: '第2页.jpg', mime: 'image/jpeg', data: new Uint8Array([1, 2, 3]) },
  ]
  const packed = pack('赵邱芯园', pages)
  const { name, pages: back } = unpack(packed)
  assert.equal(name, '赵邱芯园')
  assert.equal(back.length, 2)
  assert.equal(back[0].name, '第1页.jpg')
  assert.equal(back[0].mime, 'image/jpeg')
  assert.deepEqual([...back[0].data], [...pages[0].data])
  assert.deepEqual([...back[1].data], [...pages[1].data])
})

test('ZIP 结构可被正确解析，CRC 与内容一致', () => {
  const entries = [
    { name: '张倚晗_第1页.jpg', data: new Uint8Array([255, 216, 1, 2, 3]) },
    { name: '张倚晗_第2页.jpg', data: new Uint8Array(0) },
    { name: 'A_B-3.jpg', data: new Uint8Array([9, 8, 7, 6]) },
  ]
  const zip = createZip(entries, new Date('2026-11-19T10:00:00Z'))
  const parsed = readZip(zip)

  assert.equal(parsed.length, 3)
  for (const [index, item] of parsed.entries()) {
    assert.equal(item.name, entries[index].name)
    assert.equal(item.localName, entries[index].name)
    assert.equal(item.crc, crc32(entries[index].data))
    assert.deepEqual([...item.data], [...entries[index].data])
  }
})

test('build 端到端：产物解密、公开文件不含姓名', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'exam-drop-'))
  try {
    const source = join(dir, '试卷')
    await mkdir(join(source, '张三'), { recursive: true })
    await mkdir(join(source, '李四'), { recursive: true })
    await writeFile(join(source, '张三', 'a.jpg'), Buffer.from([255, 216, 1, 1, 1]))
    await writeFile(join(source, '张三', 'b.jpg'), Buffer.from([255, 216, 2, 2, 2]))
    await writeFile(join(source, '李四', 'c.jpg'), Buffer.from([255, 216, 3, 3, 3]))

    const roster = join(dir, 'roster.csv')
    await writeFile(roster, '学号,姓名,区队\n2026C001,张三,网安一区队\n2026D001,李四,数警一区队\n')

    const result = await build({
      sourceDir: source,
      rosterPath: roster,
      outDir: join(dir, 'dist'),
      title: '测试',
      subtitle: '',
      note: '',
      second: 'name',
      order: 'name',
      iterations: 1000,
    })
    assert.equal(result.count, 2)

    const config = JSON.parse(await readFile(join(dir, 'dist', 'config.json'), 'utf8'))
    assert.equal(config.secondFactor, 'name')
    assert.equal(config.count, 2)

    const files = await readdir(join(dir, 'dist', 'data'))
    assert.equal(files.length, 2)
    for (const file of files) {
      const bytes = await readFile(join(dir, 'dist', 'data', file))
      assert.ok(!bytes.includes(Buffer.from('张三', 'utf8')), '密文里不应出现姓名')
      assert.ok(!bytes.includes(Buffer.from('李四', 'utf8')), '密文里不应出现姓名')
    }

    const id = await recordId('2026c001', '张三', config.pepper)
    const encrypted = new Uint8Array(await readFile(join(dir, 'dist', 'data', `${id}.bin`)))
    const plain = await decryptBytes(encrypted, secretOf('2026c001', '张三', config.pepper), config.iterations)
    const { name, pages } = unpack(plain)
    assert.equal(name, '张三')
    assert.equal(pages.length, 2)

    // 页码顺序按文件名
    assert.deepEqual([...pages[0].data], [255, 216, 1, 1, 1])

    // 姓名不对打不开
    await assert.rejects(
      decryptBytes(encrypted, secretOf('2026c001', '李四', config.pepper), config.iterations),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
