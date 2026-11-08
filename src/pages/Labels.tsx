import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, canManageInventory } from '../lib/auth'
import { useCurrency } from '../lib/currency'
import { esc, printHtml } from '../lib/documents'
import { qrSvg, code128Svg, canCode128 } from '../lib/barcode'
import { consumeLabelsPreselection } from '../lib/commercialSuiteRepo'
import type { Product } from '../types'
import { Printer, Search, Lock, QrCode, Barcode } from 'lucide-react'

type Kind = 'barcode' | 'qr'
type SizeId = 'pequena' | 'mediana' | 'grande'

const SIZES: Record<SizeId, { label: string; w: number; h: number; pt: number }> = {
  pequena: { label: 'Pequeña 40 × 25 mm', w: 40, h: 25, pt: 6.5 },
  mediana: { label: 'Mediana 60 × 35 mm', w: 60, h: 35, pt: 8.5 },
  grande: { label: 'Grande 90 × 50 mm', w: 90, h: 50, pt: 11 },
}

async function fetchProducts(): Promise<Product[] | null> {
  const out: Product[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('products').select('*').order('name').range(from, from + 999)
    if (error) return null
    const rows = (data || []) as Product[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

export default function Labels() {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const allowed = canManageInventory(user?.role)

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [copies, setCopies] = useState<Record<string, number>>({})
  const [kind, setKind] = useState<Kind>('barcode')
  const [sizeId, setSizeId] = useState<SizeId>('mediana')
  const [showName, setShowName] = useState(true)
  const [showPrice, setShowPrice] = useState(true)
  const [showCode, setShowCode] = useState(true)
  const [border, setBorder] = useState(true)
  const [preselectedNotice, setPreselectedNotice] = useState('')

  useEffect(() => {
    let alive = true
    fetchProducts().then(list => {
      if (!alive) return
      if (!list) {
        setErr(!navigator.onLine ? 'Sin conexión: esta página necesita internet.' : 'No se pudieron cargar los productos.')
      } else {
        setProducts(list)
        const preIds = consumeLabelsPreselection()
        if (preIds.length > 0) {
          const validSet = new Set(list.map(p => p.id))
          const nextCopies: Record<string, number> = {}
          let count = 0
          for (const id of preIds) {
            if (validSet.has(id)) {
              nextCopies[id] = 1
              count++
            }
          }
          if (count > 0) {
            setCopies(nextCopies)
            setPreselectedNotice(
              `Se seleccionaron automáticamente ${count} producto(s) con precios recién actualizados para imprimir sus etiquetas.`
            )
          }
        }
      }
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? products.filter(p => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)) : products
  }, [products, search])

  const selected = useMemo(() => products.filter(p => (copies[p.id] || 0) > 0), [products, copies])
  const totalLabels = selected.reduce((a, p) => a + (copies[p.id] || 0), 0)

  function setCopy(id: string, n: number) {
    setCopies(c => {
      const next = { ...c }
      if (n > 0) next[id] = Math.min(500, Math.floor(n)); else delete next[id]
      return next
    })
  }
  function selectAllShown() {
    setCopies(c => {
      const next = { ...c }
      for (const p of filtered) if ((p.sku || '').trim() && !next[p.id]) next[p.id] = 1
      return next
    })
  }

  const sz: { label: string; w: number; h: number; pt: number } = SIZES[sizeId as SizeId]

  function labelFor(p: Product): { html: string; fallback: boolean } {
    const code = (p.sku || '').trim()
    const useQr = kind === 'qr' || !canCode128(code)
    const fallback = kind === 'barcode' && useQr
    let svg = ''
    try { svg = useQr ? qrSvg(code, 1) : code128Svg(code) } catch { svg = '' }
    const text = (showCode ? `<div class="cd">${esc(code)}</div>` : '')
    const name = showName ? `<div class="nm">${esc(p.name)}</div>` : ''
    const price = showPrice ? `<div class="pr">${esc(money(p.price))}</div>` : ''
    let inner: string
    if (useQr) {
      const q = Math.min(sz.h - 3, sz.w * 0.5)
      inner = `<div class="row"><div class="qr" style="width:${q}mm;height:${q}mm">${svg}</div><div class="side">${name}${price}${text}</div></div>`
    } else {
      inner = `${name}<div class="bc">${svg}</div>${text}${price}`
    }
    return { html: `<div class="l">${inner}</div>`, fallback }
  }

  const css = `
*{box-sizing:border-box}
body{margin:0;padding:3mm;font-family:Arial,Helvetica,sans-serif;color:#000}
.sheet{display:flex;flex-wrap:wrap;gap:2mm}
.l{width:${sz.w}mm;height:${sz.h}mm;padding:1.5mm;display:flex;flex-direction:column;overflow:hidden;font-size:${sz.pt}pt;line-height:1.15;break-inside:avoid;page-break-inside:avoid;${border ? 'border:0.2mm dashed #999;' : ''}}
.nm{font-weight:bold;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bc{flex:1;min-height:0;margin:0.6mm 0}
.bc svg{width:100%;height:100%;display:block}
.cd{text-align:center;letter-spacing:0.2mm;font-family:monospace}
.pr{text-align:center;font-weight:bold;font-size:${sz.pt + 1.5}pt}
.row{display:flex;align-items:center;gap:1.5mm;height:100%}
.qr svg{width:100%;height:100%;display:block}
.side{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:0.6mm}
.side .nm{white-space:normal;text-align:left;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.side .cd,.side .pr{text-align:left}
@media print{body{padding:0}}
`

  function docHtml(body: string): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Etiquetas</title><style>${css}</style></head><body>${body}</body></html>`
  }

  function print() {
    if (selected.length === 0) return
    const all: string[] = []
    for (const p of selected) {
      const { html } = labelFor(p)
      for (let i = 0; i < (copies[p.id] || 0); i++) all.push(html)
    }
    printHtml(docHtml(`<div class="sheet">${all.join('')}</div>`))
  }

  const noCode = selected.filter(p => !(p.sku || '').trim()).length
  const fallbackCount = kind === 'barcode' ? selected.filter(p => (p.sku || '').trim() && !canCode128((p.sku || '').trim())).length : 0
  const preview = selected.find(p => (p.sku || '').trim()) ?? filtered.find(p => (p.sku || '').trim())

  if (!allowed) {
    return <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs"><Lock className="w-3.5 h-3.5 shrink-0" /> Solo el dueño o el administrador pueden imprimir etiquetas.</div>
  }

  const chip = (active: boolean) => `flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium border ${active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2"><QrCode className="w-5 h-5" /> Etiquetas</h1>
        <p className="text-sm text-slate-500 mt-1">Imprime códigos de barras o QR de tus productos. El código es el SKU del producto.</p>
      </div>

      {err && <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-xs">{err}</div>}
      {preselectedNotice && (
        <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 text-xs flex items-center justify-between gap-2">
          <span>{preselectedNotice}</span>
          <button type="button" onClick={() => setPreselectedNotice('')} className="underline">Cerrar</button>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o SKU" className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm" />
            </div>
            <button onClick={selectAllShown} className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 rounded-lg shrink-0">Marcar todos</button>
            <button onClick={() => setCopies({})} className="text-xs font-medium text-slate-500 hover:text-red-600 px-2 shrink-0">Quitar</button>
          </div>

          {loading ? (
            <p className="text-sm text-slate-400 text-center py-8">Cargando...</p>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-[28rem] overflow-y-auto">
              {filtered.length === 0 && <p className="text-sm text-slate-400 text-center py-6">No hay productos</p>}
              {filtered.map(p => {
                const n = copies[p.id] || 0
                const hasCode = !!(p.sku || '').trim()
                return (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                      <p className="text-[11px] text-slate-400">{hasCode ? p.sku : 'Sin SKU'}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[11px] text-slate-400">Etiquetas</span>
                      <input type="number" inputMode="numeric" min="0" max="500" disabled={!hasCode} value={n || ''} placeholder="0" onChange={e => setCopy(p.id, parseInt(e.target.value) || 0)} className="w-16 text-center py-1.5 rounded-lg border border-slate-300 text-sm disabled:opacity-40" />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Tipo de código</label>
            <div className="flex gap-2">
              <button onClick={() => setKind('barcode')} className={chip(kind === 'barcode')}><Barcode className="w-4 h-4" /> Barras</button>
              <button onClick={() => setKind('qr')} className={chip(kind === 'qr')}><QrCode className="w-4 h-4" /> QR</button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Tamaño de la etiqueta</label>
            <select value={sizeId} onChange={e => setSizeId(e.target.value as SizeId)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
              {(Object.keys(SIZES) as SizeId[]).map(k => <option key={k} value={k}>{SIZES[k].label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
            <label className="flex items-center gap-2"><input type="checkbox" checked={showName} onChange={e => setShowName(e.target.checked)} /> Nombre</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showPrice} onChange={e => setShowPrice(e.target.checked)} /> Precio detal</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showCode} onChange={e => setShowCode(e.target.checked)} /> Código en texto</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={border} onChange={e => setBorder(e.target.checked)} /> Línea de corte</label>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">Vista previa</p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-center justify-center overflow-x-auto">
              {preview ? (
                <iframe
                  title="Vista previa"
                  srcDoc={docHtml(`<div class="sheet">${labelFor(preview).html}</div>`)}
                  style={{ width: `${Math.round(sz.w * 3.78) + 24}px`, height: `${Math.round(sz.h * 3.78) + 24}px`, border: 0, background: '#fff' }}
                />
              ) : <p className="text-sm text-slate-400">Elige un producto con SKU</p>}
            </div>
          </div>

          {noCode > 0 && <p className="text-xs text-amber-700">{noCode} producto(s) no tienen SKU y no se imprimirán.</p>}
          {fallbackCount > 0 && <p className="text-xs text-amber-700">{fallbackCount} producto(s) tienen caracteres que el código de barras no admite (acentos, ñ…): saldrán en QR.</p>}

          <button onClick={print} disabled={totalLabels === 0} className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white py-3 rounded-lg text-sm font-bold hover:bg-slate-700 disabled:opacity-40">
            <Printer className="w-4 h-4" /> Imprimir {totalLabels > 0 ? `${totalLabels} etiqueta(s)` : 'etiquetas'}
          </button>
          <p className="text-[11px] text-slate-400">En el cuadro de impresión elige papel de tamaño real (sin «ajustar a página») para que las medidas salgan exactas.</p>
        </div>
      </div>
    </div>
  )
}
