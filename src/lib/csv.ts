export type CsvCell = string | number | boolean | null | undefined

function escapeCell(value: CsvCell, sep: string): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes('"') || str.includes(sep) || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Descarga un archivo CSV con BOM UTF-8 compatible directamente con Microsoft Excel en español.
 */
export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][], sep = ';') {
  const lines = [
    headers.map(h => escapeCell(h, sep)).join(sep),
    ...rows.map(r => r.map(c => escapeCell(c, sep)).join(sep)),
  ]
  const content = '\uFEFF' + lines.join('\r\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function normalizeHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === sep && !inQuotes) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur.trim())
  return out
}

/**
 * Lee un texto CSV exportado desde Excel o Google Sheets (detecta `;`, `,` o tabulador).
 */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rawLines = clean.split('\n').filter(l => l.trim().length > 0)
  if (rawLines.length < 2) return []

  const first = rawLines[0]
  const counts: Array<[string, number]> = [
    [';', (first.match(/;/g) || []).length],
    [',', (first.match(/,/g) || []).length],
    ['\t', (first.match(/\t/g) || []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  const sep = counts[0][1] > 0 ? counts[0][0] : ';'

  const headers = splitCsvLine(first, sep).map(normalizeHeader)
  const rows: Record<string, string>[] = []

  for (let i = 1; i < rawLines.length; i++) {
    const vals = splitCsvLine(rawLines[i], sep)
    if (vals.every(v => v === '')) continue
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => {
      if (h) obj[h] = vals[idx] ?? ''
    })
    rows.push(obj)
  }

  return rows
}
