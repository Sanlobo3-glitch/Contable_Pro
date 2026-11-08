import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly } from '../lib/auth'
import { cacheGet, cacheSet, clearCustomerError, enqueueCustomer, newId, onQueueChange, onSynced, pendingToCustomer, readCustomerQueue, removePendingCustomer, sendCustomer, syncQueue, type PendingCustomer } from '../lib/offlineQueue'
import { downloadCsv, parseCsv } from '../lib/csv'
import type { Customer } from '../types'
import { Plus, X, Pencil, Trash2, Search, Lock, WifiOff, Download, Upload, FileSpreadsheet } from 'lucide-react'

const EMPTY_CUSTOMER = { name: '', document: '', email: '', phone: '', address: '', price_type: 'detal' as 'detal' | 'mayor' }

type CustomerImportRow = {
  name: string
  document: string
  email: string
  phone: string
  address: string
  price_type: 'detal' | 'mayor'
  existingId: string | null
}

export default function Customers() {
  const { user } = useAuth()
  const readOnly = isReadOnly(user)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [form, setForm] = useState(EMPTY_CUSTOMER)
  const [pendingList, setPendingList] = useState<PendingCustomer[]>([])
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState<CustomerImportRow[]>([])
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const uid = user?.id ?? ''

  useEffect(() => { load() }, [])
  async function load() {
    const { data, error } = await supabase.from('customers').select('*').order('name')
    if (error) {
      // Sin conexión: se usa la copia guardada en el teléfono
      const c = uid ? cacheGet<Customer[]>(uid, 'customers') : null
      if (c) setCustomers(c)
      return
    }
    const list = (data || []) as Customer[]
    setCustomers(list)
    if (uid) cacheSet(uid, 'customers', list)
  }

  // Clientes creados sin señal: se muestran de inmediato y se envían solos al volver la conexión
  useEffect(() => {
    if (!uid) return
    const refresh = () => setPendingList(readCustomerQueue(uid))
    refresh()
    const off = onQueueChange(refresh)
    const offSync = onSynced(r => {
      if (r.sent > 0) { setNotice(`Se enviaron ${r.sent} registro(s) guardados sin conexión.`); load() }
      if (r.failed > 0) setNotice(`${r.failed} registro(s) fueron rechazados por el servidor. Revísalos en la lista.`)
    })
    const goOnline = () => { setOnline(true); syncQueue(uid) }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => { off(); offSync(); window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(''), 7000)
    return () => window.clearTimeout(t)
  }, [notice])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || saving) return
    setSaving(true)
    if (editing) {
      if (!navigator.onLine) { setSaving(false); alert('Sin conexión: para editar un cliente necesitas internet. Crear clientes nuevos sí funciona sin señal.'); return }
      const { error } = await supabase.from('customers').update(form).eq('id', editing.id)
      if (error) { setSaving(false); alert('No se pudo guardar el cliente: ' + error.message); return }
    } else {
      const pc: PendingCustomer = { client_id: newId(), ...form, captured_at: new Date().toISOString() }
      let queued = false
      if (!navigator.onLine) {
        queued = true
      } else {
        const r = await sendCustomer(pc)
        if (!r.ok && r.network) queued = true
        else if (!r.ok) { setSaving(false); alert('No se pudo crear el cliente: ' + r.message); return }
      }
      if (queued) {
        if (!enqueueCustomer(uid, pc)) {
          setSaving(false)
          alert('No se pudo guardar el cliente en el teléfono (almacenamiento lleno o bloqueado). Conéctate a internet e inténtalo de nuevo.')
          return
        }
        setNotice('Sin conexión: el cliente quedó guardado en el teléfono. Ya puedes venderle; se enviará solo cuando vuelva la señal.')
      }
    }
    setSaving(false)
    setShowForm(false); setEditing(null); setForm(EMPTY_CUSTOMER); load()
  }
  async function del(id: string) {
    if (readOnly) return
    setErrMsg('')
    if (!navigator.onLine) { setErrMsg('Sin conexión: para eliminar un cliente necesitas internet.'); return }
    if (!confirm('¿Eliminar este cliente?')) return
    const { error } = await supabase.from('customers').delete().eq('id', id)
    if (error) {
      const msg = /foreign key|23503|violates/i.test(error.message || '')
        ? 'No se puede eliminar este cliente porque ya tiene ventas, cotizaciones o abonos registrados.'
        : 'No se pudo eliminar el cliente: ' + error.message
      setErrMsg(msg)
      return
    }
    load()
  }
  function edit(c: Customer) { if (readOnly) return; setEditing(c); setForm({ name: c.name, document: c.document || '', email: c.email || '', phone: c.phone || '', address: c.address || '', price_type: c.price_type === 'mayor' ? 'mayor' : 'detal' }); setShowForm(true) }
  const pendingIds = new Set(pendingList.map(p => p.client_id))
  const all: Customer[] = [
    ...customers.filter(c => !pendingIds.has(c.id)),
    ...pendingList.map(pendingToCustomer),
  ].sort((a, b) => a.name.localeCompare(b.name))
  const q = search.trim().toLowerCase()
  const filtered = all.filter(c =>
    !q ||
    c.name.toLowerCase().includes(q) ||
    (c.document || '').toLowerCase().includes(q) ||
    (c.phone || '').toLowerCase().includes(q) ||
    (c.email || '').toLowerCase().includes(q) ||
    (c.address || '').toLowerCase().includes(q)
  )

  function exportExcel() {
    downloadCsv(
      `clientes_${new Date().toLocaleDateString('sv-SE')}.csv`,
      ['Nombre', 'Documento', 'Teléfono', 'Email', 'Dirección', 'Tipo de precio'],
      filtered.map(c => [
        c.name,
        c.document || '',
        c.phone || '',
        c.email || '',
        c.address || '',
        c.price_type === 'mayor' ? 'mayor' : 'detal',
      ])
    )
  }

  function downloadTemplate() {
    downloadCsv(
      'plantilla_clientes.csv',
      ['nombre', 'documento', 'telefono', 'email', 'direccion', 'tipo_precio'],
      [
        ['Abasto San José', 'J-40111222-3', '0414-0001122', 'compras@sanjose.com', 'Av. Bolívar Local 4', 'mayor'],
        ['Ana Pérez', 'V-19888777', '0424-3334455', 'ana@correo.com', 'Calle 10', 'detal'],
      ]
    )
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    setImportError('')
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      const parsed = parseCsv(text)
      if (!parsed.length) {
        setImportError('El archivo está vacío o no tiene filas válidas.')
        setImportRows([])
        return
      }
      const byDoc = new Map<string, string>()
      const byName = new Map<string, string>()
      for (const c of customers) {
        if (c.document?.trim()) byDoc.set(c.document.trim().toLowerCase(), c.id)
        byName.set(c.name.trim().toLowerCase(), c.id)
      }
      const out: CustomerImportRow[] = []
      for (const r of parsed) {
        const name = (r.nombre || r.name || r.cliente || r.razon_social || '').trim()
        if (!name) continue
        const doc = (r.documento || r.rif || r.cedula || r.nit || r.dni || r.document || '').trim()
        const phone = (r.telefono || r.celular || r.phone || r.tel || '').trim()
        const email = (r.email || r.correo || r.correo_electronico || '').trim()
        const address = (r.direccion || r.address || '').trim()
        const rawType = (r.tipo_precio || r.tipo_de_precio || r.price_type || r.tipo || '').trim().toLowerCase()
        const price_type: 'detal' | 'mayor' = rawType.includes('may') ? 'mayor' : 'detal'
        const existingId = (doc && byDoc.get(doc.toLowerCase())) || byName.get(name.toLowerCase()) || null
        out.push({ name, document: doc, email, phone, address, price_type, existingId })
      }
      if (!out.length) {
        setImportError('No se encontró la columna «nombre» con clientes válidos.')
      }
      setImportRows(out)
    }
    reader.readAsText(file, 'utf-8')
  }

  async function confirmImport() {
    if (!importRows.length || importing || readOnly) return
    if (!navigator.onLine) { setImportError('Necesitas conexión a internet para importar clientes masivamente.'); return }
    setImporting(true)
    setImportError('')
    let created = 0, updated = 0, failed = 0
    for (const r of importRows) {
      const payload = {
        name: r.name,
        document: r.document || null,
        email: r.email || null,
        phone: r.phone || null,
        address: r.address || null,
        price_type: r.price_type,
      }
      if (r.existingId) {
        const { error } = await supabase.from('customers').update(payload).eq('id', r.existingId)
        if (error) failed++; else updated++
      } else {
        const { error } = await supabase.from('customers').insert(payload)
        if (error) failed++; else created++
      }
    }
    setImporting(false)
    setShowImport(false)
    setImportRows([])
    setNotice(`Importación completada: ${created} nuevo(s), ${updated} actualizado(s)${failed ? `, ${failed} con error` : ''}.`)
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-6">
        <h1 className="text-xl font-bold text-slate-800">Clientes</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportExcel}
            className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
          <button
            onClick={() => { if (readOnly) return; setImportRows([]); setImportError(''); setShowImport(true) }}
            disabled={readOnly}
            className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40"
          >
            <Upload className="w-4 h-4" /> Importar CSV
          </button>
          <button
            onClick={() => { if (readOnly) return; setEditing(null); setForm(EMPTY_CUSTOMER); setShowForm(true) }}
            disabled={readOnly}
            className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> Nuevo
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" /> Modo de solo lectura. Activa tu suscripción para crear, editar o eliminar clientes.
        </div>
      )}

      {!online && (
        <div className="flex items-center gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <WifiOff className="w-3.5 h-3.5 shrink-0" /> Sin conexión. Puedes crear clientes nuevos: se guardan en el teléfono y se envían solos al volver la señal.
        </div>
      )}
      {notice && <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 text-xs">{notice}</div>}
      {errMsg && <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-xs flex items-center justify-between gap-2"><span>{errMsg}</span><button onClick={() => setErrMsg('')} className="text-red-500 hover:text-red-700"><X className="w-3.5 h-3.5" /></button></div>}

      <div className="relative mb-4"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, documento, teléfono o correo..." className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm" /></div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase"><tr><th className="text-left px-4 py-3 font-medium">Nombre</th><th className="text-left px-4 py-3 font-medium">Documento</th><th className="text-left px-4 py-3 font-medium">Email</th><th className="text-left px-4 py-3 font-medium">Teléfono</th><th className="text-left px-4 py-3 font-medium">Acciones</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(c => {
              const pend = pendingList.find(p => p.client_id === c.id)
              return (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">
                  {c.name}
                  {c.price_type === 'mayor' && <span className="ml-2 text-[10px] font-medium text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">Mayor</span>}
                  {pend && !pend.error && <span className="ml-2 text-[10px] font-medium text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">Pendiente de enviar</span>}
                  {pend?.error && <span className="block text-xs font-normal text-red-600">Rechazado: {pend.error}</span>}
                </td>
                <td className="px-4 py-3 text-slate-500">{c.document || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{c.email || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{c.phone || '—'}</td>
                <td className="px-4 py-3">
                  {pend ? (
                    <div className="flex gap-1">
                      {pend.error && <button onClick={() => { clearCustomerError(uid, pend.client_id); syncQueue(uid) }} className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded">Reintentar</button>}
                      <button onClick={() => { if (confirm('¿Descartar este cliente? No se creará en el sistema.')) removePendingCustomer(uid, pend.client_id) }} className="text-xs font-medium text-red-600 hover:bg-red-50 px-2 py-1 rounded">Descartar</button>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <button onClick={() => edit(c)} disabled={readOnly} className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"><Pencil className="w-3.5 h-3.5 text-slate-500" /></button>
                      <button onClick={() => del(c.id)} disabled={readOnly} className="p-1.5 rounded hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>
                    </div>
                  )}
                </td>
              </tr>
              )
            })}
            {filtered.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No hay clientes</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && !readOnly && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h2 className="font-bold text-slate-800">{editing ? 'Editar' : 'Nuevo'} cliente</h2><button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button></div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Nombre</label>
                <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nombre completo" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Documento de identidad</label>
                <input value={form.document} onChange={e => setForm({ ...form, document: e.target.value })} placeholder="Ej: V-12345678, E-12345678, C-123456789" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="correo@ejemplo.com" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Teléfono</label>
                <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Teléfono" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Dirección</label>
                <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Dirección" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Tipo de precio</label>
                <select value={form.price_type} onChange={e => setForm({ ...form, price_type: e.target.value === 'mayor' ? 'mayor' : 'detal' })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
                  <option value="detal">Detal</option>
                  <option value="mayor">Por mayor</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-1">Los clientes «Por mayor» pagan el precio por mayor de cada producto.</p>
              </div>
              <button type="submit" disabled={saving} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">{saving ? 'Guardando...' : editing ? 'Guardar' : 'Crear'}</button>
            </form>
          </div>
        </div>
      )}

      {showImport && !readOnly && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { if (!importing) setShowImport(false) }}>
          <div className="bg-white rounded-xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <h2 className="font-bold text-slate-800">Importar clientes desde Excel / CSV</h2>
              </div>
              <button onClick={() => setShowImport(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-500">
              Sube un archivo CSV guardado desde Excel. Si el documento o el nombre ya existen, se actualizarán sus datos de contacto; si no, se creará como cliente nuevo.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={downloadTemplate} className="text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg">
                Descargar plantilla de ejemplo
              </button>
              <label className="text-xs font-medium bg-slate-800 text-white hover:bg-slate-700 px-3 py-1.5 rounded-lg cursor-pointer">
                Seleccionar archivo .csv
                <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} className="hidden" />
              </label>
            </div>
            {importError && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{importError}</p>}
            {importRows.length > 0 && (
              <>
                <div className="border border-slate-200 rounded-lg max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">Acción</th>
                        <th className="text-left px-3 py-2">Nombre</th>
                        <th className="text-left px-3 py-2">Documento</th>
                        <th className="text-left px-3 py-2">Teléfono</th>
                        <th className="text-left px-3 py-2">Precio</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {importRows.map((r, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1.5">
                            <span className={`px-1.5 py-0.5 rounded font-medium ${r.existingId ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
                              {r.existingId ? 'Actualizar' : 'Nuevo'}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 font-medium text-slate-800">{r.name}</td>
                          <td className="px-3 py-1.5 text-slate-500">{r.document || '—'}</td>
                          <td className="px-3 py-1.5 text-slate-500">{r.phone || '—'}</td>
                          <td className="px-3 py-1.5 capitalize text-slate-600">{r.price_type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={confirmImport}
                  disabled={importing}
                  className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
                >
                  {importing ? 'Importando clientes…' : `Confirmar importación (${importRows.length} clientes)`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
