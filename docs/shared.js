// 浏览器与 Node 共用的加解密。领取页和构建脚本共用这一份，避免两侧算法走样。

const enc = new TextEncoder()
const dec = new TextDecoder()

// 浏览器用 globalThis.crypto；Node 18 没有全局 crypto，退回 node:crypto 的 webcrypto。
const web = globalThis.crypto ?? (await import('node:crypto')).webcrypto

export const ITERATIONS = 200000

/** 学号：全角转半角，去空白/连字符，字母转小写。 */
export function normalizeSid(raw) {
  return String(raw ?? '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-_．.]/g, '')
    .toLowerCase()
}

/** 第二因子：姓名去空白；手机取后 4 位数字。 */
export function normalizeFactor(raw, mode) {
  const value = String(raw ?? '')
  if (mode === 'phone4') return value.replace(/\D/g, '').slice(-4)
  return value.replace(/\s/g, '')
}

export function secretOf(sid, factor, pepper) {
  return `${sid}|${factor}|${pepper}`
}

async function sha256(text) {
  return new Uint8Array(await web.subtle.digest('SHA-256', enc.encode(text)))
}

/** 文件键：只暴露哈希，公开目录里看不出学号。 */
export async function recordId(sid, factor, pepper) {
  const bytes = await sha256(secretOf(sid, factor, pepper))
  let out = ''
  for (const byte of bytes.slice(0, 16)) out += byte.toString(16).padStart(2, '0')
  return out
}

async function deriveKey(secret, salt, iterations = ITERATIONS) {
  const base = await web.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey'])
  return web.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** 输出 salt(16) | iv(12) | 密文。 */
export async function encryptBytes(data, secret, iterations = ITERATIONS) {
  const salt = web.getRandomValues(new Uint8Array(16))
  const iv = web.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(secret, salt, iterations)
  const cipher = new Uint8Array(await web.subtle.encrypt({ name: 'AES-GCM', iv }, key, data))
  const out = new Uint8Array(28 + cipher.length)
  out.set(salt, 0)
  out.set(iv, 16)
  out.set(cipher, 28)
  return out
}

/** 密钥不对时 AES-GCM 会抛错，调用方按“没有这份文件”处理。 */
export async function decryptBytes(buffer, secret, iterations = ITERATIONS) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const key = await deriveKey(secret, bytes.slice(0, 16), iterations)
  const plain = await web.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(16, 28) },
    key,
    bytes.slice(28),
  )
  return new Uint8Array(plain)
}

export function utf8(text) {
  return enc.encode(text)
}

export function fromUtf8(bytes) {
  return dec.decode(bytes)
}
