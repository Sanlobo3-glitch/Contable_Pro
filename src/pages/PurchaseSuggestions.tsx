import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ShoppingBasket, Copy, MessageCircle, Printer, Truck, CheckCircle2, WifiOff, ShoppingCart, Download, ClipboardCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly, canManageInventory, canManagePurchases } from '../lib/auth'
import { useCurrency, fmtNum } from '../lib/currency'
import { savePurchaseDraft, savePurchaseOrderDraft } from '../lib/purchaseDraft'
import { downloadCsv } from '../lib/csv'

interface Line {
  product_id: string
  name: string
  sku: string | null
  stock: number
  min_stock: number
  rate_day: number
  days_left: number | null
  qty: number
  unit_cost: number
  line_total: number
  supplier_id: string | null
  supplier_name: string | null
  severity: 'alta' | 'media'
}
interface Result { generated_at: string; cover_days: number; total: number; items: Line[] }

const NO_SUPPLIER = 'Sin proveedor asignado'
const PRINT_CSS = `@media print { body * { visibility: hidden !important; } .print-area, .print-area * { visibility: visible !important; }
  .print-area { position: absolute; left: 0; top: 0; width: 100%; border: none !important; } .no-print { display: none !important; } }`

const num = (n: number) => fmtNum(Number(n), 2)

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

export default function PurchaseSuggestions({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const isManager = canManagePurchases(user?.role) || canManageInventory(user?.role)
  const readOnly = isReadOnly(user) || !isManager
  const [cover, setCover] = useState(15)
  const [data, setData] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [off, setOff] = useState<Record<string, boolean>>({})       // producto -> excluido
  const [qtys, setQtys] = useState<Record<string, string>>({})      // producto -> cantidad editada
  const [note, setNote] = useState('')

  async function load(days = cover) {
    if (!isManager) return
    setLoading(true)
    setError('')
    const { data: res, error: err } = await supabase.rpc('purchase_suggestions', { p_cover_days: days })
    setLoading(false)
    if (err) {
      const missing = /purchase_suggestions|does not exist|schema cache/i.test(err.message || '')
      setError(missing ? 'sin_sql' : err.message)
      return
    }
    setData(res as Result)
    setOff({})
    setQtys({})
  }

  useEffect(() => { void load(cover) }, [cover, isManager])

  function qtyOf(l: Line): number {
    const raw = qtys[l.product_id]
    if (raw === undefined) return l.qty
    const n = Math.floor(Number(raw))
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  const groups = useMemo(() => {
    const m = new Map<string, Line[]>()
    for (const l of data?.items || []) {
      const k = l.supplier_name || NO_SUPPLIER
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(l)
    }
    return Array.from(m.entries()).sort((a, b) => (a[0] === NO_SUPPLIER ? 1 : 0) - (b[0] === NO_SUPPLIER ? 1 : 0) || a[0].localeCompare(b[0]))
  }, [data])

  const selected = (data?.items || []).filter(l => !off[l.product_id] && qtyOf(l) > 0)
  const total = selected.reduce((s, l) => s + qtyOf(l) * l.unit_cost, 0)
  const urgent = (data?.items || []).filter(l => l.severity === 'alta').length

  function orderText(supplier: string, lines: Line[]) {
    const rows = lines.filter(l => !off[l.product_id] && qtyOf(l) > 0)
    const head = supplier === NO_SUPPLIER ? 'Pedido' : `Pedido para ${supplier}`
    return `${head}\n` + rows.map(l => `• ${qtyOf(l)} x ${l.name}${l.sku ? ` (${l.sku})` : ''}`).join('\n') + '\n\nGracias.'
  }

  async function copyOrder(supplier: string, lines: Line[]) {
    const ok = await copyText(orderText(supplier, lines))
    setNote(ok ? `Pedido copiado${supplier === NO_SUPPLIER ? '' : ' para ' + supplier}. Pégalo en WhatsApp o donde quieras.` : 'No se pudo copiar. Usa el botón de WhatsApp.')
    window.setTimeout(() => setNote(''), 4000)
  }
  function convertGroupToPurchase(supplier: string, lines: Line[]) {
    if (!onNavigate || readOnly) return
    const rows = lines.filter(l => !off[l.product_id] && qtyOf(l) > 0)
    if (rows.length === 0) return
    const supId = rows.find(r => r.supplier_id)?.supplier_id ?? null
    savePurchaseDraft({
      supplier_id: supId,
      supplier_name: supplier === NO_SUPPLIER ? null : supplier,
      items: rows.map(r => ({
        product_id: r.product_id,
        product_name: r.name,
        sku: r.sku,
        quantity: qtyOf(r),
        cost: Number(r.unit_cost) || 0,
      })),
    })
    onNavigate('purchases')
  }

  function convertGroupToPurchaseOrder(supplier: string, lines: Line[]) {
    if (!onNavigate || readOnly) return
    const rows = lines.filter(l => !off[l.product_id] && qtyOf(l) > 0)
    if (rows.length === 0) return
    const supId = rows.find(r => r.supplier_id)?.supplier_id ?? null
    savePurchaseOrderDraft({
      supplier_id: supId,
      supplier_name: supplier === NO_SUPPLIER ? null : supplier,
      items: rows.map(r => ({
        product_id: r.product_id,
        product_name: r.name,
        sku: r.sku,
        quantity: qtyOf(r),
        cost: Number(r.unit_cost) || 0,
      })),
    })
    onNavigate('purchaseorders')
  }

  function exportExcel() {
    if (selected.length === 0) return
    downloadCsv(
      `sugerencia_compras_${cover}d.csv`,
      ['Proveedor', 'Producto', 'SKU', 'Stock actual', 'Stock mínimo', 'Cantidad sugerida', 'Costo unitario', 'Subtotal estimado', 'Prioridad'],
      selected.map(l => [
        l.supplier_name || NO_SUPPLIER,
        l.name,
        l.sku || '',
        l.stock,
        l.min_stock,
        qtyOf(l),
        l.unit_cost,
        Math.round(qtyOf(l) * l.unit_cost * 100) / 100,
        l.severity === 'alta' ? 'Urgente' : 'Por reponer',
      ])
    )
  }

  if (!isManager) return <p className="text-sm text-slate-500">No tienes permiso para ver esta página.</p>

  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  const sev = (s: 'alta' | 'media') => s === 'alta'
    ? <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-red-100 text-red-700">Urgente</span>
    : <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-800">Por reponer</span>

  return (
    <div className="max-w-3xl space-y-4">
      <style>{PRINT_CSS}</style>

      <div className="no-print flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center shrink-0"><ShoppingBasket className="w-5 h-5 text-white" /></div>
            <h1 className="text-xl font-bold text-slate-800">Sugerencia de compras</h1>
          </div>
          <p className="text-sm text-slate-600 mt-2">Qué conviene comprar según lo que vendes. Ajusta cantidades, envía el pedido o conviértelo en compra recibida con un clic.</p>
        </div>
        <button onClick={() => load()} disabled={loading || offline} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40 shrink-0">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">Actualizar</span>
        </button>
      </div>

      <div className="no-print bg-white rounded-xl border border-slate-200 p-3">
        <p className="text-xs font-medium text-slate-500 mb-2">¿Para cuántos días quieres tener mercancía?</p>
        <div className="flex gap-1 p-1 bg-slate-50 rounded-lg">
          {[7, 15, 30].map(d => (
            <button key={d} onClick={() => setCover(d)} className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${cover === d ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-white'}`}>{d} días</button>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Se calcula con tu ritmo de ventas de los últimos 30 y 90 días (sin contar ventas anuladas), y nunca por debajo del stock mínimo de cada producto.</p>
      </div>

      {offline && (
        <div className="no-print flex items-center gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs"><WifiOff className="w-3.5 h-3.5 shrink-0" /> Sin conexión: necesitas internet para calcular la sugerencia.</div>
      )}
      {error === 'sin_sql' && (
        <div className="no-print text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-sm">
          <p className="font-medium">Esta función aún no está activada en tu base de datos.</p>
          <p className="text-xs mt-1">Ejecuta el SQL de «Sugerencia de compras» en Supabase (SQL Editor) y pulsa Actualizar.</p>
        </div>
      )}
      {error && error !== 'sin_sql' && <div className="no-print text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs">No se pudo calcular: {error}</div>}
      {note && <div className="no-print text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs">{note}</div>}

      {loading && !data && <p className="text-sm text-slate-400 text-center py-10">Calculando…</p>}

      {data && !error && data.items.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <p className="font-semibold text-slate-800 mt-3">No necesitas comprar nada por ahora</p>
          <p className="text-sm text-slate-500 mt-1">Con tu ritmo de ventas, el stock alcanza para los próximos {data.cover_days} días.</p>
        </div>
      )}

      {data && !error && data.items.length > 0 && (
        <>
          <div className="no-print grid grid-cols-3 gap-2">
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Productos</p><p className="text-lg font-bold text-slate-800">{selected.length}<span className="text-xs font-normal text-slate-400"> de {data.items.length}</span></p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Urgentes</p><p className={`text-lg font-bold ${urgent > 0 ? 'text-red-600' : 'text-slate-800'}`}>{urgent}</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">Inversión estimada</p><p className="text-lg font-bold text-slate-800 break-words">{money(total)}</p></div>
          </div>

          <div className="print-area space-y-4">
            <div className="hidden print:block">
              <h2 className="text-base font-bold text-slate-800">Sugerencia de compras · {data.cover_days} días</h2>
              <p className="text-xs text-slate-500">{new Date(data.generated_at).toLocaleString()}</p>
            </div>
            {groups.map(([supplier, lines]) => {
              const rows = lines.filter(l => !off[l.product_id] && qtyOf(l) > 0)
              const sub = rows.reduce((s, l) => s + qtyOf(l) * l.unit_cost, 0)
              return (
                <div key={supplier} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0"><Truck className="w-4 h-4 text-slate-400 shrink-0" /><h3 className="text-sm font-bold text-slate-700 truncate">{supplier}</h3></div>
                    <span className="text-xs text-slate-500 whitespace-nowrap">{money(sub)}</span>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {lines.map(l => {
                      const on = !off[l.product_id]
                      return (
                        <li key={l.product_id} className={`py-2.5 flex items-start gap-3 ${on ? '' : 'opacity-50'}`}>
                          <input type="checkbox" checked={on} onChange={() => setOff(o => ({ ...o, [l.product_id]: on }))} className="no-print mt-1 w-4 h-4 accent-slate-800 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-slate-800">{l.name}</p>{sev(l.severity)}
                            </div>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Stock {num(l.stock)}{l.min_stock > 0 ? ` (mín. ${num(l.min_stock)})` : ''}
                              {l.rate_day > 0 ? ` · vendes ≈ ${num(l.rate_day)}/día` : ''}
                              {l.days_left !== null ? ` · te alcanza ${l.days_left <= 0 ? '0' : num(l.days_left)} d` : ''}
                            </p>
                            <p className="text-[11px] text-slate-400">Costo {money(l.unit_cost)} c/u{l.supplier_name ? '' : ' (costo del producto)'}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="flex items-center gap-1 justify-end">
                              <span className="text-xs text-slate-400">Pedir</span>
                              <input
                                type="number" inputMode="numeric" min={0} value={qtys[l.product_id] ?? String(l.qty)}
                                onChange={e => setQtys(q => ({ ...q, [l.product_id]: e.target.value }))}
                                className="no-print w-16 px-2 py-1 rounded-lg border border-slate-300 text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-700"
                              />
                              <span className="hidden print:inline text-sm font-semibold">{qtyOf(l)}</span>
                            </div>
                            <p className="text-xs font-semibold text-slate-700 mt-1">{money(qtyOf(l) * l.unit_cost)}</p>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                  <div className="no-print flex gap-2 mt-3 flex-wrap">
                    {onNavigate && !readOnly && (
                      <>
                        <button
                          onClick={() => convertGroupToPurchaseOrder(supplier, lines)}
                          disabled={rows.length === 0}
                          className="inline-flex items-center gap-1.5 bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0"
                        >
                          <ClipboardCheck className="w-3.5 h-3.5" /> Emitir Orden de Compra
                        </button>
                        <button
                          onClick={() => convertGroupToPurchase(supplier, lines)}
                          disabled={rows.length === 0}
                          className="inline-flex items-center gap-1.5 bg-white border border-slate-300 text-slate-800 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
                        >
                          <ShoppingCart className="w-3.5 h-3.5" /> Compra directa
                        </button>
                      </>
                    )}
                    <button onClick={() => copyOrder(supplier, lines)} disabled={rows.length === 0} className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-200 disabled:opacity-40 whitespace-nowrap shrink-0"><Copy className="w-3.5 h-3.5" /> Copiar pedido</button>
                    {rows.length > 0 && (
                      <a
                        href={'https://wa.me/?text=' + encodeURIComponent(orderText(supplier, lines))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-700 whitespace-nowrap shrink-0"
                      >
                        <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
            <div className="hidden print:flex justify-between border-t-2 border-slate-300 pt-2 text-sm font-bold text-slate-900"><span>Inversión estimada</span><span>{money(total)}</span></div>
          </div>

          <div className="no-print flex gap-2 flex-wrap">
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 whitespace-nowrap shrink-0"><Printer className="w-4 h-4" /> Imprimir lista</button>
            <button onClick={exportExcel} disabled={selected.length === 0} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"><Download className="w-4 h-4" /> Exportar Excel</button>
            {onNavigate && <button onClick={() => onNavigate('purchaseorders')} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 whitespace-nowrap shrink-0"><ClipboardCheck className="w-4 h-4" /> Ver Órdenes de Compra</button>}
            {onNavigate && <button onClick={() => onNavigate('purchases')} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 whitespace-nowrap shrink-0"><Truck className="w-4 h-4" /> Ver Compras</button>}
          </div>
          <p className="no-print text-[11px] text-slate-400 leading-relaxed">
            Esto es una sugerencia: usa «Cargar en Nueva compra» cuando recibas el pedido para registrarlo sin volver a digitar cada producto.
          </p>
        </>
      )}
    </div>
  )
}
