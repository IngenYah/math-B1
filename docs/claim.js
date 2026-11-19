import {
  normalizeSid,
  normalizeFactor,
  recordId,
  decryptBytes,
  secretOf,
  ITERATIONS,
} from './shared.js'
import { unpack } from './container.js'
import { createZip } from './zip.js'

const $ = (id) => document.getElementById(id)

const els = {
  form: $('form'),
  sid: $('sid'),
  factorWrap: $('factor-wrap'),
  factor: $('factor'),
  factorLabel: $('factor-label'),
  submit: $('submit'),
  status: $('status'),
  result: $('result'),
  whoName: $('who-name'),
  whoMeta: $('who-meta'),
  pages: $('pages'),
  zip: $('zip'),
  eyebrow: $('eyebrow'),
  title: $('title'),
  subtitle: $('subtitle'),
  note: $('note'),
  viewer: $('viewer'),
  viewerImg: $('viewer-img'),
}

const FACTOR = {
  name: { label: '姓名', placeholder: '请输入本人姓名', mode: 'text' },
  phone4: { label: '手机号后 4 位', placeholder: '例如 8899', mode: 'numeric' },
}

let config = null
let mode = 'none'
let holder = null // { name, pages: [{ name, mime, data, url }] }

function setStatus(text, kind = '') {
  els.status.textContent = text
  els.status.className = kind ? `status ${kind}` : 'status'
}

function setOptional(el, text) {
  if (text) el.textContent = text
  else el.hidden = true
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

async function boot() {
  try {
    const res = await fetch('./config.json', { cache: 'no-store' })
    if (!res.ok) throw new Error(String(res.status))
    config = await res.json()
  } catch {
    setStatus('页面数据没有加载成功，请刷新重试，或联系老师确认地址。', 'error')
    return
  }

  mode = config.secondFactor ?? 'none'
  document.title = config.title || document.title
  setOptional(els.title, config.title)
  setOptional(els.subtitle, config.subtitle)
  setOptional(els.note, config.note)

  if (mode !== 'none') {
    const info = FACTOR[mode] ?? { label: '验证信息', placeholder: '', mode: 'text' }
    els.factorWrap.hidden = false
    els.factorLabel.textContent = info.label
    els.factor.placeholder = info.placeholder
    els.factor.inputMode = info.mode
    els.factor.required = true
  }

  els.form.hidden = false
  setStatus('')
}

function clearResult() {
  if (holder) {
    for (const page of holder.pages) URL.revokeObjectURL(page.url)
    holder = null
  }
  els.pages.replaceChildren()
  els.result.hidden = true
}

async function unlock() {
  const sid = normalizeSid(els.sid.value)
  if (sid.length < 4) {
    setStatus('请输入完整学号。', 'error')
    els.sid.focus()
    return
  }
  const factor = mode === 'none' ? '' : normalizeFactor(els.factor.value, mode)
  if (mode === 'name' && factor.length < 2) {
    setStatus('请把姓名填写完整。', 'error')
    els.factor.focus()
    return
  }
  if (mode === 'phone4' && !/^\d{4}$/.test(factor)) {
    setStatus('请输入手机号后 4 位数字。', 'error')
    els.factor.focus()
    return
  }

  els.submit.disabled = true
  clearResult()
  setStatus('正在解锁…')

  try {
    const pepper = config.pepper ?? ''
    const iterations = config.iterations ?? ITERATIONS
    const id = await recordId(sid, factor, pepper)

    let response
    try {
      response = await fetch(`./data/${id}.bin`, { cache: 'no-store' })
    } catch {
      throw new Error('network')
    }
    if (!response.ok) throw new Error('missing')

    const encrypted = new Uint8Array(await response.arrayBuffer())
    const plain = await decryptBytes(encrypted, secretOf(sid, factor, pepper), iterations)
    const { name, pages } = unpack(plain)
    show(name, pages)
  } catch (error) {
    if (error?.message === 'network') {
      setStatus('网络好像有问题，请稍后重试。', 'error')
    } else if (error?.message === 'missing') {
      setStatus('没有找到对应记录。请核对学号与本人信息是否和名单一致。', 'error')
    } else {
      setStatus('没有找到对应记录。请核对学号与本人信息是否和名单一致。', 'error')
    }
  } finally {
    els.submit.disabled = false
  }
}

function show(name, pages) {
  holder = {
    name,
    pages: pages.map((page) => ({
      ...page,
      url: URL.createObjectURL(new Blob([page.data], { type: page.mime })),
    })),
  }

  els.whoName.textContent = name || '你的试卷'
  const bytes = holder.pages.reduce((sum, page) => sum + page.data.length, 0)
  els.whoMeta.textContent = `共 ${holder.pages.length} 张 · ${humanSize(bytes)}`
  els.zip.textContent = `打包下载（${holder.pages.length} 张，${humanSize(bytes)}）`

  for (const [index, page] of holder.pages.entries()) {
    const figure = document.createElement('figure')
    figure.className = 'page'
    if (page.mime === 'application/pdf') {
      const link = document.createElement('a')
      link.href = page.url
      link.target = '_blank'
      link.rel = 'noopener'
      link.textContent = '打开 PDF'
      figure.append(link)
    } else {
      const img = document.createElement('img')
      img.src = page.url
      img.alt = `${name} 第 ${index + 1} 张`
      img.loading = 'lazy'
      figure.append(img)
      figure.addEventListener('click', () => {
        els.viewerImg.src = page.url
        els.viewer.hidden = false
      })
    }
    const caption = document.createElement('figcaption')
    caption.textContent = `第 ${index + 1} 张`
    figure.append(caption)
    els.pages.append(figure)
  }

  els.result.hidden = false
  setStatus('已经解开，可以逐张查看或打包下载。')
}

function downloadZip() {
  if (!holder) return
  const entries = holder.pages.map((page, index) => ({
    name: `${holder.name}_第${index + 1}张${page.mime === 'application/pdf' ? '.pdf' : '.jpg'}`,
    data: page.data,
  }))
  const blob = new Blob([createZip(entries)], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${holder.name}_期中试卷.zip`
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  setStatus('已开始下载压缩包。')
}

els.form.addEventListener('submit', (event) => {
  event.preventDefault()
  unlock()
})

els.zip.addEventListener('click', downloadZip)

els.viewer.addEventListener('click', () => {
  els.viewer.hidden = true
  els.viewerImg.removeAttribute('src')
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.viewer.hidden) {
    els.viewer.hidden = true
    els.viewerImg.removeAttribute('src')
  }
})

boot()
