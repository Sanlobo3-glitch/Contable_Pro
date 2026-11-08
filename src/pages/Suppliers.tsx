import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly, canManageInventory } from '../lib/auth'
import { downloadCsv } from '../lib/csv'
import type { Supplier } from '../types'
import { Plus, X, Pencil, Trash2, Search, Lock, Download } from 'lucide-react'

const EMPTY_FORM = { name: '', document: '', email: '', phone: '', address: '' }

export default function Suppliers() {
  const { user } = useAuth()
  const noPermission = !canManageInventory(user?.role)
  const readOnly = isReadOnly(user) || noPermission

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    void load()
  }, [])

  function flash(msg: string) {
    setNotice(msg)
    window.setTimeout(() => setNotice(''), 5000)
  }

  async function load() {
    const { data, error } = await supabase.from('suppliers').select('*').order('name')
    if (error) {
      alert('No se pudieron cargar los proveedores: ' + error.message)
      return
    }
    setSuppliers((data || []) as Supplier[])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || saving) return
    setSaving(true)

    const payload = {
      name: form.name.trim(),
      document: form.document.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
    }

    const res = editing
      ? await supabase.from('suppliers').update(payload).eq('id', editing.id)
      : await supabase.from('suppliers').insert(payload)

    setSaving(false)

    if (res.error) {
      alert('No se pudo guardar el proveedor: ' + res.error.message)
      return
    }

    setShowForm(false)
    setEditing(null)
    setForm(EMPTY_FORM)
    await load()
    flash(editing ? 'Proveedor actualizado.' : 'Proveedor creado.')
  }

  async function del(s: Supplier) {
    if (readOnly) return
    if (!confirm(`¿Eliminar a «${s.name}»?`)) return
    const { error } = await supabase.from('suppliers').delete().eq('id', s.id)
    if (error) {
      if (/foreign key|23503|restrict/i.test(error.message || '')) {
        alert('No se puede eliminar este proveedor porque ya tiene compras o pagos asociados.')
      } else {
        alert('No se pudo eliminar el proveedor: ' + error.message)
      }
      return
    }
    await load()
    flash('Proveedor eliminado.')
  }

  function edit(s: Supplier) {
    if (readOnly) return
    setEditing(s)
    setForm({
      name: s.name,
      document: s.document || '',
      email: s.email || '',
      phone: s.phone || '',
      address: s.address || '',
    })
    setShowForm(true)
  }

  function exportExcel() {
    if (suppliers.length === 0) return
    downloadCsv(
      `proveedores_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Nombre', 'Documento / RIF', 'Teléfono', 'Correo', 'Dirección'],
      suppliers.map(s => [s.name, s.document || '', s.phone || '', s.email || '', s.address || ''])
    )
  }

  const q = search.trim().toLowerCase()
  const filtered = suppliers.filter(s =>
    !q ||
    s.name.toLowerCase().includes(q) ||
    (s.document || '').toLowerCase().includes(q) ||
    (s.phone || '').toLowerCase().includes(q) ||
    (s.email || '').toLowerCase().includes(q)
  )

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-6 flex-wrap">
        <h1 className="text-xl font-bold text-slate-800">Proveedores</h1>
        <div className="flex items-center gap-2">
          {suppliers.length > 0 && (
            <button
              onClick={exportExcel}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
            >
              <Download className="w-4 h-4" /> Exportar Excel
            </button>
          )}
          <button
            onClick={() => {
              if (readOnly) return
              setEditing(null)
              setForm(EMPTY_FORM)
              setShowForm(true)
            }}
            disabled={readOnly}
            className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> Nuevo
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          {noPermission
            ? 'Solo el dueño o el administrador pueden crear, editar o eliminar proveedores.'
            : 'Modo de solo lectura. Activa tu suscripción para crear, editar o eliminar proveedores.'}
        </div>
      )}

      {notice && (
        <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 text-xs">
          {notice}
        </div>
      )}

      <div className="relative mb-4">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, documento, teléfono o correo..."
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Nombre</th>
              <th className="text-left px-4 py-3 font-medium">Documento</th>
              <th className="text-left px-4 py-3 font-medium">Email</th>
              <th className="text-left px-4 py-3 font-medium">Teléfono</th>
              <th className="text-left px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(s => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">
                  {s.name}
                  {s.address && <span className="block text-xs font-normal text-slate-400 truncate max-w-xs">{s.address}</span>}
                </td>
                <td className="px-4 py-3 text-slate-500">{s.document || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{s.email || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{s.phone || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button
                      onClick={() => edit(s)}
                      disabled={readOnly}
                      title="Editar"
                      className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Pencil className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                    <button
                      onClick={() => void del(s)}
                      disabled={readOnly}
                      title="Eliminar"
                      className="p-1.5 rounded hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No hay proveedores
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && !readOnly && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !saving && setShowForm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800">{editing ? 'Editar' : 'Nuevo'} proveedor</h2>
              <button onClick={() => !saving && setShowForm(false)} className="p-1 rounded hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                required
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Nombre o razón social"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
              <input
                value={form.document}
                onChange={e => setForm({ ...form, document: e.target.value })}
                placeholder="Documento / RIF / NIT"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
              <input
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="Correo electrónico"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
              <input
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                placeholder="Teléfono"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
              <input
                value={form.address}
                onChange={e => setForm({ ...form, address: e.target.value })}
                placeholder="Dirección"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
              <button
                type="submit"
                disabled={saving}
                className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
              >
                {saving ? 'Guardando...' : editing ? 'Guardar' : 'Crear'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
