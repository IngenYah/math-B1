// 单个学生的试卷容器：姓名 + 若干页（文件名/MIME/字节）。
// 整块容器会被整体加密，所以这里的字段只有拿到密钥后才可见。

import { utf8, fromUtf8 } from './shared.mjs'

const MAGIC = utf8('EDP1')

export function pack(name, pages) {
  const parts = []
  const push = (bytes) => parts.push(bytes)

  const nameBytes = utf8(name ?? '')
  const head = new Uint8Array(4 + 2 + nameBytes.length + 2)
  head.set(MAGIC, 0)
  const view = new DataView(head.buffer)
  view.setUint16(4, nameBytes.length, true)
  head.set(nameBytes, 6)
  view.setUint16(6 + nameBytes.length, pages.length, true)
  push(head)

  for (const page of pages) {
    const pageName = utf8(page.name ?? '')
    const mime = utf8(page.mime ?? 'application/octet-stream')
    const header = new Uint8Array(2 + pageName.length + 2 + mime.length + 4)
    const pageView = new DataView(header.buffer)
    pageView.setUint16(0, pageName.length, true)
    header.set(pageName, 2)
    pageView.setUint16(2 + pageName.length, mime.length, true)
    header.set(mime, 4 + pageName.length)
    pageView.setUint32(4 + pageName.length + mime.length, page.data.length, true)
    push(header)
    push(page.data)
  }

  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function unpack(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.length < 6) throw new Error('容器太短')
  for (let i = 0; i < 4; i += 1) {
    if (bytes[i] !== MAGIC[i]) throw new Error('容器格式不对')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 4
  const nameLength = view.getUint16(offset, true)
  offset += 2
  const name = fromUtf8(bytes.slice(offset, offset + nameLength))
  offset += nameLength
  const count = view.getUint16(offset, true)
  offset += 2

  const pages = []
  for (let index = 0; index < count; index += 1) {
    const pageNameLength = view.getUint16(offset, true)
    offset += 2
    const pageName = fromUtf8(bytes.slice(offset, offset + pageNameLength))
    offset += pageNameLength
    const mimeLength = view.getUint16(offset, true)
    offset += 2
    const mime = fromUtf8(bytes.slice(offset, offset + mimeLength))
    offset += mimeLength
    const dataLength = view.getUint32(offset, true)
    offset += 4
    pages.push({ name: pageName, mime, data: bytes.slice(offset, offset + dataLength) })
    offset += dataLength
  }
  return { name, pages }
}
