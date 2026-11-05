import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly } from '../lib/auth'
import type { Category } from '../types'
import { Plus, X, Pencil, Trash2, Tag, Lock } from 'lucide-react'

export default function Categories() {
  const { user } = useAuth()
  const readOnly = isReadOnly(user)
  const [categories, setCategories] = useState<Category[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })

  useEffect(() => { load() }, [])
  async function load() { const { data } = await supabase.from('categories').select('*').order('name'); setCategories((data || []) as Category[]) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly) return
    if (editing) await supabase.from('categories').update(form).eq('id', editing.id)
    else await supabase.from('categories').insert(form)
    setShowForm(false); setEditing(null); setForm({ name: '', description: '' }); load()
  }
  async function del(id: string) { if (readOnly) return; if (confirm('¿Eliminar categoría?')) { await supabase.from('categories').delete().eq('id', id); load() } }
  function edit(c: Category) { if (readOnly) return; setEditing(c); setForm({ name: c.name, description: c.description || '' }); setShowForm(true) }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-800">Categorías</h1>
        <button
          onClick={() => { if (readOnly) return; setEditing(null); setShowForm(true) }}
          disabled={readOnly}
          className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" /> Nueva
        </button>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" /> Modo de solo lectura. Activa tu suscripción para crear, editar o eliminar categorías.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {categories.map(c => (
          <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center"><Tag className="w-4 h-4 text-slate-500" /></div><h3 className="font-medium text-slate-800">{c.name}</h3></div>
              <div className="flex gap-1">
                <button onClick={() => edit(c)} disabled={readOnly} className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"><Pencil className="w-3.5 h-3.5 text-slate-500" /></button>
                <button onClick={() => del(c.id)} disabled={readOnly} className="p-1 rounded hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>
              </div>
            </div>
            {c.description && <p className="text-xs text-slate-500 mt-2">{c.description}</p>}
          </div>
        ))}
        {categories.length === 0 && <p className="text-sm text-slate-400 col-span-full text-center py-8">No hay categorías</p>}
      </div>

      {showForm && !readOnly && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h2 className="font-bold text-slate-800">{editing ? 'Editar' : 'Nueva'} categoría</h2><button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nombre" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Descripción" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" rows={3} />
              <button type="submit" className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700">{editing ? 'Guardar' : 'Crear'}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
