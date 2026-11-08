import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { KardexEntry } from '../types'
import { Search, ClipboardList } from 'lucide-react'

export default function Kardex() {
  const [entries, setEntries] = useState<KardexEntry[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [])
  async function load() { const { data } = await supabase.from('kardex').select('*').order('created_at', { ascending: false }).limit(200); setEntries((data || []) as KardexEntry[]) }
  const filtered = entries.filter(e => e.product_name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <div className="mb-6"><h1 className="text-xl font-bold text-slate-800">Kardex</h1><p className="text-sm text-slate-500 mt-1">Movimientos de inventario</p></div>
      <div className="relative mb-4"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto..." className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm" /></div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase"><tr><th className="text-left px-4 py-3 font-medium">Fecha</th><th className="text-left px-4 py-3 font-medium">Producto</th><th className="text-left px-4 py-3 font-medium">Tipo</th><th className="text-left px-4 py-3 font-medium">Cant.</th><th className="text-left px-4 py-3 font-medium">Saldo</th><th className="text-left px-4 py-3 font-medium">Ref.</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(e => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-600">{new Date(e.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{e.product_name}</td>
                <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-1 rounded ${e.type === 'entrada' ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'}`}>{e.type}</span></td>
                <td className="px-4 py-3 text-slate-700">{e.quantity}</td>
                <td className="px-4 py-3 text-slate-700">{e.balance}</td>
                <td className="px-4 py-3 text-slate-500 capitalize">{e.reference_type}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400"><div className="flex flex-col items-center gap-2"><ClipboardList className="w-8 h-8 text-slate-300" /><span>No hay movimientos</span></div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
