#!/usr/bin/env node
// 本地预览 docs/：node tools/serve.mjs [目录] [端口]
// 浏览器打开 http://127.0.0.1:5173 即可。页面用了 ES module，直接双击 index.html 会白屏。

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

const root = resolve(process.argv[2] ?? 'docs')
const port = Number(process.argv[3] ?? 5173)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const pathname = decodeURIComponent(url.pathname)
    let target = resolve(join(root, pathname === '/' ? '/index.html' : pathname))
    if (!target.startsWith(root + sep) && target !== root) {
      res.writeHead(403).end('forbidden')
      return
    }
    const info = await stat(target)
    if (info.isDirectory()) target = join(target, 'index.html')
    const body = await readFile(target)
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`预览：http://127.0.0.1:${port}  （目录 ${root}）`)
})
