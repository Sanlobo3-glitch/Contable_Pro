import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, Lightbulb, Printer, Search } from 'lucide-react'
import { CHAPTERS, FAQ, QUICK_START, norm, type RoleKey } from '../lib/manualContent'
import { Chip, Mock } from '../components/ManualMocks'

/* ───────── Página ───────── */

export default function Manual({ standalone = false, role, onNavigate }: {
  standalone?: boolean
  role?: string
  onNavigate?: (page: string) => void
}) {
  const myRole: RoleKey =
    role === 'admin' || role === 'super_admin' ? 'admin'
    : role === 'contador' ? 'contador'
    : role === 'vendedor' ? 'vendedor'
    : role === 'transportador' ? 'transportador'
    : role === 'gerente' ? 'gerente'
    : role === 'almacen' ? 'almacen'
    : role === 'tecnico' ? 'tecnico'
    : 'dueno'

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'todos' | RoleKey>(
    role === 'admin' || role === 'super_admin' ? 'admin'
    : role === 'contador' ? 'contador'
    : role === 'vendedor' ? 'vendedor'
    : role === 'transportador' ? 'transportador'
    : role === 'gerente' ? 'gerente'
    : 'todos'
  )
  const [open, setOpen] = useState<string | null>(null)
  const [all, setAll] = useState(false)

  useEffect(() => {
    const h = window.location.hash.replace('#', '')
    if (h && CHAPTERS.some(c => c.id === h)) {
      setOpen(h)
      window.setTimeout(() => document.getElementById('cap-' + h)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
    }
  }, [])
  useEffect(() => {
    const after = () => setAll(false)
    window.addEventListener('afterprint', after)
    return () => window.removeEventListener('afterprint', after)
  }, [])

  const list = useMemo(() => {
    const q = norm(query.trim())
    return CHAPTERS.filter(c => {
      if (filter !== 'todos' && !c.roles.includes(filter)) return false
      if (!q) return true
      return norm([c.title, c.summary, ...c.steps, ...(c.tips ?? [])].join(' ')).includes(q)
    })
  }, [query, filter])

  const faq = useMemo(() => {
    const q = norm(query.trim())
    return q ? FAQ.filter(f => norm(f.q + ' ' + f.a).includes(q)) : FAQ
  }, [query])

  function goTo(id: string) {
    setOpen(id)
    window.setTimeout(() => document.getElementById('cap-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }
  function printAll() {
    setAll(true)
    window.setTimeout(() => window.print(), 250)
  }

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${active ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'}`

  const content = (
    <div>
      <style>{`@media print { .no-print { display: none !important; } .manual-card { break-inside: avoid; } body { background: #fff; } }`}</style>

      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Manual de usuario</h1>
          <p className="text-sm text-slate-500 mt-1">Guía ilustrada paso a paso de cada módulo de InventarioPro.</p>
        </div>
        <button onClick={printAll} className="no-print flex items-center gap-2 bg-slate-800 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 shrink-0">
          <Printer className="w-4 h-4" /> <span className="hidden sm:inline">Imprimir / PDF</span>
        </button>
      </div>

      <div className="no-print space-y-3 mb-5">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar: catálogo, WhatsApp, OCR, cuaderno, Siigo, Loggro, lotes…" className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700 focus:border-transparent" />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button onClick={() => setFilter('todos')} className={chip(filter === 'todos')}>Todos ({CHAPTERS.length})</button>
          <button onClick={() => setFilter('admin')} className={chip(filter === 'admin')}>Admin Central</button>
          <button onClick={() => setFilter('dueno')} className={chip(filter === 'dueno')}>Dueño / Empresa</button>
          <button onClick={() => setFilter('gerente')} className={chip(filter === 'gerente')}>Gerente</button>
          <button onClick={() => setFilter('contador')} className={chip(filter === 'contador')}>Contador (NIIF)</button>
          <button onClick={() => setFilter('vendedor')} className={chip(filter === 'vendedor')}>Vendedor</button>
          <button onClick={() => setFilter('transportador')} className={chip(filter === 'transportador')}>Transporte</button>
          <button onClick={() => setFilter('tecnico')} className={chip(filter === 'tecnico')}>Soporte Técnico</button>
          <button onClick={() => setAll(v => !v)} className={chip(false) + ' ml-auto'}>{all ? 'Contraer todo' : 'Expandir todo'}</button>
        </div>
      </div>

      {!query && (
        <section className="manual-card bg-white rounded-xl border border-slate-200 p-5 mb-5">
          <h2 className="font-bold text-slate-800">Empieza aquí: tu primer día en {QUICK_START.length} pasos</h2>
          <p className="text-xs text-slate-500 mt-1">Para dueños que están configurando el negocio. Los vendedores pueden ir directo a Ventas/Mostrador y los contadores a Despacho contable o Migración Siigo / Loggro.</p>
          <ol className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {QUICK_START.map((s, i) => (
              <li key={i} className="flex items-start gap-3 rounded-lg bg-slate-50 border border-slate-100 p-3">
                <span className="w-6 h-6 rounded-full bg-slate-800 text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <div><p className="text-sm font-semibold text-slate-800">{s.t}</p><p className="text-xs text-slate-500">{s.d}</p></div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="no-print mb-5">
        <p className="text-xs font-bold text-slate-500 uppercase mb-2">Índice</p>
        <div className="flex flex-wrap gap-2">
          {list.map(c => {
            const Icon = c.icon
            return (
              <button key={c.id} onClick={() => goTo(c.id)} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full pl-2.5 pr-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                <Icon className="w-3.5 h-3.5" /> {c.title.split(',')[0].split(' y ')[0]}
              </button>
            )
          })}
        </div>
      </section>

      <div className="space-y-3">
        {list.length === 0 && <p className="text-center text-sm text-slate-400 py-8">No encontramos nada con «{query}». Prueba con otra palabra.</p>}
        {list.map((c, idx) => {
          const Icon = c.icon
          const isOpen = all || open === c.id
          return (
            <article key={c.id} id={'cap-' + c.id} className="manual-card bg-white rounded-xl border border-slate-200 overflow-hidden scroll-mt-16">
              <button onClick={() => setOpen(isOpen && !all ? null : c.id)} className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50">
                <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0"><Icon className="w-5 h-5 text-slate-700" /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800">{idx + 1}. {c.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{c.summary}</p>
                </div>
                <div className="hidden sm:flex flex-wrap gap-1 shrink-0 max-w-[200px] justify-end">
                  {c.roles.includes('admin') && <Chip tone="red">Admin Central</Chip>}
                  {c.roles.includes('dueno') && <Chip tone="slate">Dueño</Chip>}
                  {c.roles.includes('gerente') && <Chip tone="amber">Gerente</Chip>}
                  {c.roles.includes('contador') && <Chip tone="green">Contador</Chip>}
                  {c.roles.includes('vendedor') && <Chip tone="indigo">Vendedor</Chip>}
                  {c.roles.includes('transportador') && <Chip tone="indigo">Transporte</Chip>}
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="border-t border-slate-100 p-4 grid md:grid-cols-[11rem_1fr] gap-5">
                  <Mock kind={c.mock} />
                  <div>
                    <p className="text-sm text-slate-600">{c.summary}</p>
                    <p className="text-xs font-bold text-slate-500 uppercase mt-4 mb-2">Paso a paso</p>
                    <ol className="space-y-2">
                      {c.steps.map((s, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                          <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ol>
                    {c.tips && c.tips.length > 0 && (
                      <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-1.5">
                        {c.tips.map((t, i) => (
                          <p key={i} className="flex items-start gap-2 text-xs text-amber-900"><Lightbulb className="w-3.5 h-3.5 shrink-0 mt-px" /> <span>{t}</span></p>
                        ))}
                      </div>
                    )}
                    {onNavigate && c.page && c.roles.includes(myRole) && (
                      <button onClick={() => onNavigate(c.page as string)} className="no-print mt-4 inline-flex items-center gap-2 bg-slate-800 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-700">
                        Abrir este módulo <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>

      {faq.length > 0 && (
        <section className="manual-card mt-6">
          <h2 className="font-bold text-slate-800 mb-3">Preguntas frecuentes</h2>
          <div className="space-y-2">
            {faq.map((f, i) => (
              <details key={i} open={all} className="bg-white rounded-xl border border-slate-200 px-4 py-3 group">
                <summary className="cursor-pointer text-sm font-medium text-slate-800 list-none flex items-center justify-between gap-2">
                  {f.q}<ChevronDown className="w-4 h-4 text-slate-400 shrink-0 group-open:rotate-180 transition-transform" />
                </summary>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <p className="text-center text-xs text-slate-400 mt-8">
        ¿Algo no quedó claro? Escríbele a tu administrador o al soporte de InventarioPro.
      </p>
    </div>
  )

  if (!standalone) return content

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="no-print bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <a href="/" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-800"><ArrowLeft className="w-4 h-4" /> Volver a InventarioPro</a>
        </div>
      </header>
      <div className="max-w-4xl mx-auto px-4 py-6">{content}</div>
      <footer className="pb-8 text-center no-print">
        <p className="text-[10px] text-slate-400"><span className="font-semibold text-slate-500">Copyright</span> · Desarrollado por <span className="font-semibold text-slate-600">Richard J. Lobo S.</span></p>
        <p className="text-[10px] text-slate-400 mt-2"><a href="/terminos" className="underline hover:text-slate-600">Términos y condiciones</a>{' · '}<a href="/privacidad" className="underline hover:text-slate-600">Política de privacidad</a></p>
      </footer>
    </div>
  )
}
