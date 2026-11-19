// 极简 CSV：支持双引号包裹、内嵌逗号和换行、CRLF、UTF-8 BOM（Excel 另存的常见形态）。

export function parseCsv(text) {
  const source = String(text).replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

const HEADERS = {
  学号: 'sid',
  姓名: 'name',
  名字: 'name',
  手机后4位: 'phone4',
  手机号后4位: 'phone4',
  手机: 'phone4',
  区队: 'team',
  班级: 'team',
  成绩: 'score',
  sid: 'sid',
  name: 'name',
  phone4: 'phone4',
  team: 'team',
  score: 'score',
}

/** 首行做表头，返回对象数组；未知列忽略。 */
export function csvObjects(text) {
  const rows = parseCsv(text)
  if (rows.length === 0) return []
  const keys = rows[0].map((header) => HEADERS[header.trim()] ?? null)
  return rows.slice(1).map((cells) => {
    const item = {}
    keys.forEach((key, index) => {
      if (key) item[key] = (cells[index] ?? '').trim()
    })
    return item
  })
}
