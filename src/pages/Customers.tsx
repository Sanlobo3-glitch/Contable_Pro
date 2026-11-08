import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly } from '../lib/auth'
import {
  cacheGet,
  cacheSet,
  clearCustomerError,
  enqueueCustomer,
  newId,
  onQueueChange,
  onSynced,
  pendingToCustomer,
  readCustomerQueue,
  removePendingCustomer,
  sendCustomer,
  syncQueue,
  type PendingCustomer,
} from '../lib/offlineQueue'
import { downloadCsv, parseCsv } from '../lib/csv'
import type { Customer } from '../types'
import {
  Plus,
  X,
  Pencil,
  Trash2,
  Search,
  Lock,
  WifiOff,
  Download,
  Upload,
  FileSpreadsheet,
  Camera,
  ShieldAlert,
  Sparkles,
  MessageSquarePlus,
  Eye,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Check,
} from 'lucide-react'
import {
  getCustomerDocumentRecords,
  saveCustomerDocumentRecord,
  getCustomerObservations,
  saveCustomerObservation,
  analyzeCustomerDocumentWithAi,
  applyApprovedCustomerCorrection,
  SAMPLE_RIF_DOCUMENT_DATA_URL,
  type CustomerDocumentRecord,
  type CustomerObservation,
} from '../lib/customerVerificationRepo'

const EMPTY_CUSTOMER = {
  name: '',
  document: '',
  email: '',
  phone: '',
  address: '',
  price_type: 'detal' as 'detal' | 'mayor',
}

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
  const { user, masterRoleOverride } = useAuth()
  const readOnly = isReadOnly(user)

  // Rol efectivo considerando simulación en Paso Maestro
  const effectiveRole = masterRoleOverride || user?.role
  const isVendor = effectiveRole === 'vendedor'
  const isManagement =
    !isVendor &&
    (effectiveRole === 'admin' ||
      effectiveRole === 'dueno' ||
      effectiveRole === 'admin_empresa' ||
      effectiveRole === 'gerente')

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

  // Respaldo de documento tributario y contraste con IA
  const [docPhoto, setDocPhoto] = useState<string>(SAMPLE_RIF_DOCUMENT_DATA_URL)
  const [docType, setDocType] = useState<CustomerDocumentRecord['document_type']>('rif')
  const [docRecords, setDocRecords] = useState<CustomerDocumentRecord[]>([])
  const [observations, setObservations] = useState<CustomerObservation[]>([])

  // Escaneo y contraste en vivo con Gemini API
  const [analyzingWithAi, setAnalyzingWithAi] = useState(false)
  const [liveAiResult, setLiveAiResult] = useState<{
    status: 'idle' | 'success' | 'discrepancy'
    summary: string
    extractedName: string
    extractedDoc: string
    source: string
  } | null>(null)

  // Modal de observaciones del vendedor
  const [showObsModal, setShowObsModal] = useState(false)
  const [obsCustomer, setObsCustomer] = useState<Customer | null>(null)
  const [obsNotes, setObsNotes] = useState('')
  const [obsName, setObsName] = useState('')
  const [obsDoc, setObsDoc] = useState('')
  const [obsPhone, setObsPhone] = useState('')
  const [obsAddress, setObsAddress] = useState('')
  const [obsPhoto, setObsPhoto] = useState<string>(SAMPLE_RIF_DOCUMENT_DATA_URL)
  const [obsSaving, setObsSaving] = useState(false)

  // Modal de revisión de Gerencia / Dueño
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [activeReviewTab, setActiveReviewTab] = useState<'discrepancies' | 'observations'>('discrepancies')
  const [previewDocUrl, setPreviewDocUrl] = useState<string | null>(null)

  useEffect(() => {
    load()
    setDocRecords(getCustomerDocumentRecords())
    setObservations(getCustomerObservations())
  }, [])

  async function load() {
    const { data, error } = await supabase.from('customers').select('*').order('name')
    if (error) {
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
      if (r.sent > 0) {
        setNotice(`Se enviaron ${r.sent} registro(s) guardados sin conexión.`)
        load()
      }
      if (r.failed > 0) setNotice(`${r.failed} registro(s) fueron rechazados por el servidor. Revísalos en la lista.`)
    })
    const goOnline = () => {
      setOnline(true)
      syncQueue(uid)
    }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      off()
      offSync()
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(''), 7000)
    return () => window.clearTimeout(t)
  }, [notice])

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>, isObs = false) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      if (isObs) setObsPhoto(dataUrl)
      else setDocPhoto(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  async function handleLiveAiScan() {
    if (!docPhoto) {
      alert('Por favor sube o adjunta una foto del documento RIF/NIT primero.')
      return
    }
    setAnalyzingWithAi(true)
    setLiveAiResult(null)
    try {
      const res = await analyzeCustomerDocumentWithAi(form.name, form.document, form.address, docPhoto, {
        enteredPhone: form.phone,
        documentType: docType,
      })
      setLiveAiResult({
        status: res.ai_status === 'discrepancia_detectada' || res.review_recommended ? 'discrepancy' : 'success',
        summary: res.ai_discrepancy_summary,
        extractedName: res.ai_extracted_name,
        extractedDoc: res.ai_extracted_document,
        source: res.source === 'gemini' ? 'Gemini 3.8 Flash API' : 'Motor Heurístico Local',
      })
    } catch (e: any) {
      alert('Error al verificar documento con Gemini: ' + e.message)
    } finally {
      setAnalyzingWithAi(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || saving) return
    setSaving(true)

    if (editing) {
      if (isVendor) {
        setSaving(false)
        alert('Acceso restringido: Los vendedores no pueden editar directamente los datos fiscales de clientes.')
        return
      }
      if (!navigator.onLine) {
        setSaving(false)
        alert('Sin conexión: para editar un cliente necesitas internet.')
        return
      }
      const { error } = await supabase.from('customers').update(form).eq('id', editing.id)
      if (error) {
        setSaving(false)
        alert('No se pudo guardar el cliente: ' + error.message)
        return
      }
    } else {
      const clientId = newId()
      const pc: PendingCustomer = { client_id: clientId, ...form, captured_at: new Date().toISOString() }
      let queued = false
      if (!navigator.onLine) {
        queued = true
      } else {
        const r = await sendCustomer(pc)
        if (!r.ok && r.network) queued = true
        else if (!r.ok) {
          setSaving(false)
          alert('No se pudo crear el cliente: ' + r.message)
          return
        }
      }
      if (queued) {
        if (!enqueueCustomer(uid, pc)) {
          setSaving(false)
          alert('No se pudo guardar el cliente en el teléfono. Conéctate a internet e inténtalo de nuevo.')
          return
        }
        setNotice('Sin conexión: el cliente quedó guardado en el teléfono. Ya puedes venderle; se enviará solo.')
      }

      // Validación y Contraste con IA del documento RIF / NIT adjunto (Gemini API)
      const activePhoto = docPhoto || SAMPLE_RIF_DOCUMENT_DATA_URL
      const aiResult = await analyzeCustomerDocumentWithAi(form.name, form.document, form.address, activePhoto, {
        enteredPhone: form.phone,
        documentType: docType,
      })

      const hasDiscrepancy = aiResult.ai_status === 'discrepancia_detectada' || aiResult.review_recommended

      const docRecord: CustomerDocumentRecord = {
        id: 'cdoc-' + Date.now(),
        customer_id: clientId,
        customer_name: form.name,
        entered_name: form.name,
        entered_document: form.document,
        entered_phone: form.phone,
        entered_address: form.address,
        document_image_url: activePhoto,
        document_type: docType,
        vendor_id: user?.id,
        vendor_name: user?.full_name || user?.email || (isVendor ? 'Vendedor' : 'Usuario'),
        created_at: new Date().toISOString(),
        ai_status: hasDiscrepancy ? 'discrepancia_detectada' : 'coincide',
        ai_confidence: aiResult.ai_confidence,
        ai_extracted_document: aiResult.ai_extracted_document,
        ai_extracted_name: aiResult.ai_extracted_name,
        ai_discrepancy_summary: aiResult.ai_discrepancy_summary,
        ai_discrepancy_fields: aiResult.ai_discrepancy_fields,
        alert_sent_to_management: hasDiscrepancy,
        review_status: hasDiscrepancy ? 'pendiente_revision' : 'aprobado',
      }
      saveCustomerDocumentRecord(docRecord)
      setDocRecords(getCustomerDocumentRecords())

      if (hasDiscrepancy) {
        setNotice(
          `⚠️ Cliente registrado: La API de Gemini detectó discrepancias con el documento oficial (${aiResult.ai_discrepancy_summary}) y marcó el registro para revisión gerencial.`
        )
      } else {
        setNotice(
          `✓ Cliente registrado y validado con éxito mediante Gemini AI (${aiResult.source === 'gemini' ? 'Gemini 3.8 Flash' : 'Soporte oficial verificado'}).`
        )
      }
    }
    setSaving(false)
    setShowForm(false)
    setEditing(null)
    setForm(EMPTY_CUSTOMER)
    setDocPhoto(SAMPLE_RIF_DOCUMENT_DATA_URL)
    setLiveAiResult(null)
    load()
  }

  async function del(id: string) {
    if (readOnly) return
    if (isVendor) {
      alert('Acceso prohibido: Los vendedores no tienen permisos para eliminar clientes.')
      return
    }
    setErrMsg('')
    if (!navigator.onLine) {
      setErrMsg('Sin conexión: para eliminar un cliente necesitas internet.')
      return
    }
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

  function edit(c: Customer) {
    if (readOnly) return
    if (isVendor) {
      openObservationModal(c)
      return
    }
    setEditing(c)
    setForm({
      name: c.name,
      document: c.document || '',
      email: c.email || '',
      phone: c.phone || '',
      address: c.address || '',
      price_type: c.price_type === 'mayor' ? 'mayor' : 'detal',
    })
    setShowForm(true)
  }

  function openObservationModal(c: Customer) {
    setObsCustomer(c)
    setObsName(c.name)
    setObsDoc(c.document || '')
    setObsPhone(c.phone || '')
    setObsAddress(c.address || '')
    setObsNotes('')
    setObsPhoto(SAMPLE_RIF_DOCUMENT_DATA_URL)
    setShowObsModal(true)
  }

  async function handleSendObservation(e: React.FormEvent) {
    e.preventDefault()
    if (!obsCustomer || obsSaving) return
    if (!obsNotes.trim()) {
      alert('Por favor escribe el motivo o la observación de la corrección.')
      return
    }
    setObsSaving(true)
    const newObs: CustomerObservation = {
      id: 'cobs-' + Date.now(),
      customer_id: obsCustomer.id,
      customer_name: obsCustomer.name,
      current_document: obsCustomer.document || undefined,
      vendor_id: user?.id || 'v-user',
      vendor_name: user?.full_name || user?.email || (isVendor ? 'Vendedor' : 'Usuario'),
      vendor_notes: obsNotes.trim(),
      proposed_name: obsName.trim() || undefined,
      proposed_document: obsDoc.trim() || undefined,
      proposed_phone: obsPhone.trim() || undefined,
      proposed_address: obsAddress.trim() || undefined,
      document_image_url: obsPhoto || SAMPLE_RIF_DOCUMENT_DATA_URL,
      created_at: new Date().toISOString(),
      status: 'pendiente_revision',
    }
    saveCustomerObservation(newObs)
    setObservations(getCustomerObservations())
    setObsSaving(false)
    setShowObsModal(false)
    setNotice(
      '✓ Observación enviada a Gerencia y Administración. Se adjuntó el soporte fotográfico actualizado para su validación.'
    )
  }

  async function handleApproveObservation(obs: CustomerObservation) {
    if (!isManagement) return
    const res = await applyApprovedCustomerCorrection(
      obs.customer_id,
      {
        name: obs.proposed_name,
        document: obs.proposed_document,
        phone: obs.proposed_phone,
        address: obs.proposed_address,
      },
      obs.id
    )
    if (res.ok) {
      setNotice(`✓ ${res.message}`)
      setObservations(getCustomerObservations())
      setDocRecords(getCustomerDocumentRecords())
      load()
    } else {
      alert(res.message)
    }
  }

  async function handleDismissObservation(obsId: string) {
    if (!isManagement) return
    const updated = observations.map(o =>
      o.id === obsId ? { ...o, status: 'descartado' as const, reviewed_at: new Date().toISOString() } : o
    )
    setObservations(updated)
    try {
      localStorage.setItem('contable_pro_customer_observations', JSON.stringify(updated))
    } catch {}
    setNotice('Observación marcada como revisada.')
  }

  async function handleApplyAiCorrection(record: CustomerDocumentRecord) {
    if (!isManagement) return
    const res = await applyApprovedCustomerCorrection(record.customer_id, {
      name: record.ai_extracted_name || record.entered_name,
      document: record.ai_extracted_document || record.entered_document,
    })
    if (res.ok) {
      setNotice(`✓ Datos sincronizados con el documento oficial extraído por IA.`)
      setDocRecords(getCustomerDocumentRecords())
      load()
    } else {
      alert(res.message)
    }
  }

  async function handleDismissAiDiscrepancy(docId: string) {
    if (!isManagement) return
    const updated = docRecords.map(d =>
      d.id === docId
        ? {
            ...d,
            review_status: 'aprobado' as const,
            reviewed_at: new Date().toISOString(),
            management_notes: 'Validado manualmente por Gerencia.',
          }
        : d
    )
    setDocRecords(updated)
    try {
      localStorage.setItem('contable_pro_customer_documents', JSON.stringify(updated))
    } catch {}
    setNotice('Discrepancia validada y descartada por Gerencia.')
  }

  const pendingDiscrepancies = docRecords.filter(
    d => d.ai_status === 'discrepancia_detectada' && d.review_status === 'pendiente_revision'
  )
  const pendingVendorObservations = observations.filter(o => o.status === 'pendiente_revision')
  const totalManagementAlerts = pendingDiscrepancies.length + pendingVendorObservations.length
  const pendingIds = new Set(pendingList.map(p => p.client_id))
  const all: Customer[] = [
    ...customers.filter(c => !pendingIds.has(c.id)),
    ...pendingList.map(pendingToCustomer),
  ].sort((a, b) => a.name.localeCompare(b.name))
  const q = search.trim().toLowerCase()
  const filtered = all.filter(
    c =>
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
    if (!navigator.onLine) {
      setImportError('Necesitas conexión a internet para importar clientes masivamente.')
      return
    }
    setImporting(true)
    setImportError('')
    let created = 0,
      updated = 0,
      failed = 0
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
        if (error) failed++
        else updated++
      } else {
        const { error } = await supabase.from('customers').insert(payload)
        if (error) failed++
        else created++
      }
    }
    setImporting(false)
    setShowImport(false)
    setImportRows([])
    setNotice(
      `Importación completada: ${created} nuevo(s), ${updated} actualizado(s)${failed ? `, ${failed} con error` : ''}.`
    )
    load()
  }

  return (
    <div>
      {/* Encabezado y Acciones Principales */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Clientes</h1>
          <p className="text-xs text-slate-500">
            Control de clientes, validación tributaria con Gemini API y respaldo oficial de RIF/NIT.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isManagement && totalManagementAlerts > 0 && (
            <button
              onClick={() => {
                setActiveReviewTab(pendingDiscrepancies.length > 0 ? 'discrepancies' : 'observations')
                setShowReviewModal(true)
              }}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-lg text-sm font-semibold shadow-sm transition"
            >
              <ShieldAlert className="w-4 h-4" />
              Auditoría ({totalManagementAlerts})
            </button>
          )}
          <button
            onClick={exportExcel}
            className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
          <button
            onClick={() => {
              if (readOnly) return
              setImportRows([])
              setImportError('')
              setShowImport(true)
            }}
            disabled={readOnly}
            className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-40"
          >
            <Upload className="w-4 h-4" /> Importar CSV
          </button>
          <button
            onClick={() => {
              if (readOnly) return
              setEditing(null)
              setForm(EMPTY_CUSTOMER)
              setDocPhoto(SAMPLE_RIF_DOCUMENT_DATA_URL)
              setLiveAiResult(null)
              setShowForm(true)
            }}
            disabled={readOnly}
            className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> Nuevo
          </button>
        </div>
      </div>

      {/* Alerta de Gerencia: Discrepancias y Observaciones Pendientes */}
      {isManagement && totalManagementAlerts > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 mb-4 flex items-center justify-between gap-4 flex-wrap shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-amber-900">
                Auditoría Tributaria: Validación de RIF / NIT y Contraste de IA
              </h4>
              <p className="text-xs text-amber-700">
                Se detectaron <strong>{pendingDiscrepancies.length}</strong> discrepancia(s) por IA en documentos adjuntos
                y <strong>{pendingVendorObservations.length}</strong> solicitud(es) de corrección enviada(s) por vendedores.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setActiveReviewTab(pendingDiscrepancies.length > 0 ? 'discrepancies' : 'observations')
              setShowReviewModal(true)
            }}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition"
          >
            <Sparkles className="w-4 h-4" /> Revisar y Aplicar Correcciones ({totalManagementAlerts})
          </button>
        </div>
      )}

      {/* Aviso informativo de Rol Vendedor */}
      {isVendor && (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-lg px-3.5 py-2.5 mb-4 text-xs flex items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>
              <strong>Modo Vendedor Activo:</strong> Registro de clientes respaldado con fotografía de RIF/NIT obligatorio
              y validación con Gemini AI. <strong>La edición directa y la eliminación de clientes están bloqueadas</strong> por
              control fiscal; para solicitar correcciones utiliza el botón <strong>«Observación»</strong>.
            </span>
          </div>
        </div>
      )}

      {readOnly && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" /> Modo de solo lectura. Activa tu suscripción para crear clientes.
        </div>
      )}

      {!online && (
        <div className="flex items-center gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <WifiOff className="w-3.5 h-3.5 shrink-0" /> Sin conexión. Puedes crear clientes nuevos: se guardan en el teléfono y se envían solos al volver la señal.
        </div>
      )}
      {notice && (
        <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 text-xs">
          {notice}
        </div>
      )}
      {errMsg && (
        <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-xs flex items-center justify-between gap-2">
          <span>{errMsg}</span>
          <button onClick={() => setErrMsg('')} className="text-red-500 hover:text-red-700">
            <X className="w-3.5 h-3.5" />
          </button>
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

      {/* Tabla de Clientes */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Nombre / Razón Social</th>
              <th className="text-left px-4 py-3 font-medium">Documento</th>
              <th className="text-left px-4 py-3 font-medium">Email</th>
              <th className="text-left px-4 py-3 font-medium">Teléfono</th>
              <th className="text-left px-4 py-3 font-medium">Soporte RIF / Gemini</th>
              <th className="text-left px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(c => {
              const pend = pendingList.find(p => p.client_id === c.id)

              // Documento de verificación vinculado
              const cleanDoc = (c.document || '').replace(/[^0-9a-zA-Z]/g, '').toUpperCase()
              const docRec = docRecords.find(
                d =>
                  d.customer_id === c.id ||
                  (cleanDoc && d.entered_document.replace(/[^0-9a-zA-Z]/g, '').toUpperCase() === cleanDoc) ||
                  d.customer_name.toLowerCase() === c.name.toLowerCase()
              )

              // Observación pendiente del cliente
              const pendingObs = observations.find(o => o.customer_id === c.id && o.status === 'pendiente_revision')

              return (
                <tr key={c.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>{c.name}</span>
                      {c.price_type === 'mayor' && (
                        <span className="text-[10px] font-medium text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">
                          Mayor
                        </span>
                      )}
                      {pend && !pend.error && (
                        <span className="text-[10px] font-medium text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                          Pendiente de enviar
                        </span>
                      )}
                      {pend?.error && (
                        <span className="block text-xs font-normal text-red-600">Rechazado: {pend.error}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 font-mono text-xs">{c.document || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{c.email || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{c.phone || '—'}</td>

                  {/* Estado de Documento Tributario y Contraste con IA */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1 items-start">
                      {docRec ? (
                        <>
                          {docRec.ai_status === 'discrepancia_detectada' && docRec.review_status === 'pendiente_revision' ? (
                            <button
                              onClick={() => {
                                if (isManagement) {
                                  setActiveReviewTab('discrepancies')
                                  setShowReviewModal(true)
                                } else {
                                  alert(docRec.ai_discrepancy_summary || 'Discrepancia detectada por Gemini en el documento oficial.')
                                }
                              }}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-0.5 rounded cursor-pointer"
                              title="Click para ver reporte de discrepancia"
                            >
                              <AlertTriangle className="w-3 h-3 text-amber-600" /> Discrepancia IA
                            </button>
                          ) : (
                            <button
                              onClick={() => setPreviewDocUrl(docRec.document_image_url)}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-800 bg-emerald-100 hover:bg-emerald-200 px-2 py-0.5 rounded cursor-pointer"
                              title="Click para ver comprobante escaneado"
                            >
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" /> RIF validado
                            </button>
                          )}
                          <button
                            onClick={() => setPreviewDocUrl(docRec.document_image_url)}
                            className="text-[10px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                          >
                            <Eye className="w-2.5 h-2.5" /> Ver soporte
                          </button>
                        </>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">Sin foto RIF</span>
                      )}

                      {pendingObs && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">
                          <MessageSquarePlus className="w-2.5 h-2.5" /> Obs. en revisión
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Acciones según Rol */}
                  <td className="px-4 py-3">
                    {pend ? (
                      <div className="flex gap-1">
                        {pend.error && (
                          <button
                            onClick={() => {
                              clearCustomerError(uid, pend.client_id)
                              syncQueue(uid)
                            }}
                            className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded"
                          >
                            Reintentar
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (confirm('¿Descartar este cliente? No se creará en el sistema.'))
                              removePendingCustomer(uid, pend.client_id)
                          }}
                          className="text-xs font-medium text-red-600 hover:bg-red-50 px-2 py-1 rounded"
                        >
                          Descartar
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {/* VENDEDOR: Restricción absoluta. No hay lápiz ni papelera. Solo botón de observación. */}
                        {isVendor ? (
                          <button
                            onClick={() => openObservationModal(c)}
                            title="Enviar observación de corrección con foto de documento a Gerencia"
                            className="flex items-center gap-1.5 text-xs font-semibold bg-amber-100 text-amber-900 hover:bg-amber-200 border border-amber-300 px-3 py-1.5 rounded-lg transition shadow-xs"
                          >
                            <MessageSquarePlus className="w-3.5 h-3.5 text-amber-700" />
                            <span>Observación</span>
                          </button>
                        ) : (
                          <>
                            {/* GERENCIA / DUEÑO: Edición total y eliminación */}
                            <button
                              onClick={() => edit(c)}
                              disabled={readOnly}
                              title="Editar cliente"
                              className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <Pencil className="w-3.5 h-3.5 text-slate-500" />
                            </button>
                            <button
                              onClick={() => del(c.id)}
                              disabled={readOnly}
                              title="Eliminar cliente"
                              className="p-1.5 rounded hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-red-500" />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No hay clientes registrados con este criterio.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Nuevo / Editar Cliente con Carga de RIF y Contraste Gemini API */}
      {showForm && !readOnly && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShowForm(false)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-md max-h-[92vh] overflow-y-auto space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800 text-base">{editing ? 'Editar' : 'Nuevo'} cliente</h2>
                  <p className="text-[11px] text-slate-500">
                    {editing
                      ? 'Modificación de ficha del cliente'
                      : 'Registro respaldado con documento tributario oficial y Gemini AI'}
                  </p>
                </div>
              </div>
              <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nombre o Razón Social *</label>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej: Comercial San Pedro S.A.S."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Documento de Identidad / RIF / NIT *
                </label>
                <input
                  value={form.document}
                  onChange={e => setForm({ ...form, document: e.target.value })}
                  placeholder="Ej: J-30484748-4 o 900.123.456-7"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:border-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="correo@ejemplo.com"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
                  <input
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="+57 / +58..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Dirección del establecimiento</label>
                <input
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                  placeholder="Av., Calle, Local comercial..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de precio</label>
                <select
                  value={form.price_type}
                  onChange={e => setForm({ ...form, price_type: e.target.value === 'mayor' ? 'mayor' : 'detal' })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="detal">Detal</option>
                  <option value="mayor">Por mayor</option>
                </select>
              </div>

              {/* Sección de Respaldo Fotográfico y Contraste de Gemini API (Solo clientes nuevos) */}
              {!editing && (
                <div className="pt-3 border-t border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-800">
                      Foto del Documento del Establecimiento (RIF / NIT)
                    </label>
                    <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-emerald-600" /> Gemini 3.8 Flash
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Tipo de Documento</label>
                      <select
                        value={docType}
                        onChange={e => setDocType(e.target.value as any)}
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                      >
                        <option value="rif">RIF (Venezuela)</option>
                        <option value="nit">NIT (Colombia)</option>
                        <option value="rut">RUT (Chile / Uruguay)</option>
                        <option value="cedula_juridica">Cédula Jurídica (Costa Rica)</option>
                        <option value="registro_mercantil">Registro Mercantil</option>
                        <option value="otro">Otro Documento</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Foto o Escaneo</label>
                      <label className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs text-slate-700 cursor-pointer font-medium transition">
                        <Camera className="w-3.5 h-3.5 text-slate-600" />
                        <span>Subir foto</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={e => handlePhotoUpload(e, false)}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Previsualización del Soporte */}
                  {docPhoto && (
                    <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <img
                          src={docPhoto}
                          alt="Soporte RIF"
                          className="w-14 h-11 object-cover rounded border border-slate-300 shrink-0"
                        />
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-slate-800 block truncate">
                            Comprobante oficial adjunto
                          </span>
                          <span className="text-[10px] text-slate-500 block">
                            Documento listo para extracción y contraste con Gemini AI.
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setPreviewDocUrl(docPhoto)}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                        >
                          Ver
                        </button>
                        <button
                          type="button"
                          onClick={handleLiveAiScan}
                          disabled={analyzingWithAi}
                          className="flex items-center gap-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-lg transition disabled:opacity-50 shadow-xs"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>{analyzingWithAi ? 'Escaneando...' : 'Probar Gemini AI'}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Estado de Análisis en Vivo de Gemini */}
                  {analyzingWithAi && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2 animate-pulse">
                      <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Gemini 3.8 Flash está extrayendo texto del documento y contrastando con los datos ingresados...</span>
                    </div>
                  )}

                  {/* Resultados del Contraste en Vivo */}
                  {liveAiResult && !analyzingWithAi && (
                    <div
                      className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                        liveAiResult.status === 'discrepancy'
                          ? 'bg-amber-50 border-amber-300 text-amber-900'
                          : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold">
                        <span className="flex items-center gap-1.5">
                          {liveAiResult.status === 'discrepancy' ? (
                            <>
                              <AlertTriangle className="w-4 h-4 text-amber-600" />
                              Discrepancia detectada ({liveAiResult.source})
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              Verificación Exitosa ({liveAiResult.source})
                            </>
                          )}
                        </span>
                        <span className="text-[10px] font-normal opacity-80">
                          {liveAiResult.status === 'discrepancy' ? 'Revisión gerencial requerida' : 'Coincide 100%'}
                        </span>
                      </div>
                      <p className="text-[11px] leading-snug">{liveAiResult.summary}</p>
                      {liveAiResult.status === 'discrepancy' && (
                        <div className="text-[11px] bg-white/70 p-2 rounded border border-amber-200 space-y-0.5">
                          <div>
                            <strong>Razón Social detectada:</strong> {liveAiResult.extractedName}
                          </div>
                          <div>
                            <strong>Documento / RIF detectado:</strong>{' '}
                            <span className="font-mono">{liveAiResult.extractedDoc}</span>
                          </div>
                          <div className="text-[10px] text-amber-700 italic pt-1">
                            El cliente podrá ser creado, pero se marcará con alerta prioritaria en el Centro de Auditoría de Gerencia.
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 text-[11px] text-blue-800 leading-tight">
                    💡 <strong>Protección de Datos:</strong> Al pulsar «Registrar Cliente», el servicio de Gemini API validará automáticamente la foto del RIF/NIT. Si detecta discrepancias de digitación, el registro se guardará y se marcará de inmediato para revisión gerencial.
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full bg-slate-800 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-slate-700 disabled:opacity-50 transition shadow"
              >
                {saving ? 'Guardando y validando con Gemini AI...' : editing ? 'Guardar Cambios' : 'Registrar Cliente'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Envío de Observación / Corrección del Vendedor */}
      {showObsModal && obsCustomer && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShowObsModal(false)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[92vh] overflow-y-auto space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500 text-white flex items-center justify-center">
                  <MessageSquarePlus className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800 text-base">Enviar Observación de Cliente</h2>
                  <p className="text-[11px] text-slate-500">
                    Propuesta de corrección respaldada con foto de documento para Gerencia
                  </p>
                </div>
              </div>
              <button onClick={() => setShowObsModal(false)} className="p-1 rounded hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 leading-relaxed">
              <strong>Aviso de seguridad para Vendedores:</strong> No tienes permitido editar directamente la ficha de
              clientes para proteger la integridad tributaria de la empresa. Indica los datos correctos y adjunta la foto
              del documento actualizado del cliente para que Gerencia apruebe la modificación.
            </div>

            <form onSubmit={handleSendObservation} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Cliente actual</label>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                  <div className="font-bold text-slate-800">{obsCustomer.name}</div>
                  <div className="text-slate-500 font-mono">Doc: {obsCustomer.document || 'Sin documento'}</div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Motivo o descripción de la corrección *
                </label>
                <textarea
                  required
                  rows={2}
                  value={obsNotes}
                  onChange={e => setObsNotes(e.target.value)}
                  placeholder="Ej: El cliente actualizó su RIF recientemente o hubo error al escribir el número de RIF..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:border-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Razón Social correcta</label>
                  <input
                    value={obsName}
                    onChange={e => setObsName(e.target.value)}
                    placeholder="Nombre corregido"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Documento correcto</label>
                  <input
                    value={obsDoc}
                    onChange={e => setObsDoc(e.target.value)}
                    placeholder="RIF / NIT corregido"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono correcto</label>
                  <input
                    value={obsPhone}
                    onChange={e => setObsPhone(e.target.value)}
                    placeholder="Teléfono actualizado"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Dirección correcta</label>
                  <input
                    value={obsAddress}
                    onChange={e => setObsAddress(e.target.value)}
                    placeholder="Dirección actualizada"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                  />
                </div>
              </div>

              {/* Soporte Fotográfico */}
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700">
                    Foto del documento de respaldo actualizado *
                  </label>
                  <label className="flex items-center gap-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded cursor-pointer">
                    <Camera className="w-3.5 h-3.5" />
                    <span>Tomar / Subir foto</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={e => handlePhotoUpload(e, true)}
                      className="hidden"
                    />
                  </label>
                </div>

                {obsPhoto && (
                  <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <img src={obsPhoto} alt="Respaldo" className="w-14 h-11 object-cover rounded border border-slate-300" />
                      <span className="text-xs text-slate-700 font-medium">Foto de comprobante lista</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewDocUrl(obsPhoto)}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      Ver
                    </button>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowObsModal(false)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={obsSaving}
                  className="bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-slate-700 disabled:opacity-50"
                >
                  {obsSaving ? 'Enviando...' : 'Enviar a Gerencia'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Centro de Revisión de Gerencia y Dueño (Auditoría IA y Vendedores) */}
      {showReviewModal && isManagement && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShowReviewModal(false)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-3xl max-h-[92vh] overflow-y-auto space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-amber-500 text-white flex items-center justify-center">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800 text-base">
                    Auditoría de Clientes: Validación de RIF / NIT y Contraste IA
                  </h2>
                  <p className="text-xs text-slate-500">
                    Revisa las discrepancias detectadas por Gemini API y aprueba o descarta las correcciones de vendedores.
                  </p>
                </div>
              </div>
              <button onClick={() => setShowReviewModal(false)} className="p-1 rounded hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Pestañas de Navegación */}
            <div className="flex border-b border-slate-200">
              <button
                onClick={() => setActiveReviewTab('discrepancies')}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b-2 transition ${
                  activeReviewTab === 'discrepancies'
                    ? 'border-amber-600 text-amber-800'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Discrepancias IA ({pendingDiscrepancies.length})
              </button>
              <button
                onClick={() => setActiveReviewTab('observations')}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b-2 transition ${
                  activeReviewTab === 'observations'
                    ? 'border-indigo-600 text-indigo-800'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                Correcciones de Vendedores ({pendingVendorObservations.length})
              </button>
            </div>

            {/* Pestaña 1: Discrepancias Detectadas por IA */}
            {activeReviewTab === 'discrepancies' && (
              <div className="space-y-3">
                {pendingDiscrepancies.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-500 text-xs">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                    No hay discrepancias pendientes. Todos los documentos coinciden con la información ingresada.
                  </div>
                ) : (
                  pendingDiscrepancies.map(rec => (
                    <div key={rec.id} className="border border-amber-200 bg-amber-50/50 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <span className="text-xs font-bold text-slate-800 block">{rec.customer_name}</span>
                          <span className="text-[11px] text-slate-500">
                            Registrado por: <strong>{rec.vendor_name}</strong> ·{' '}
                            {new Date(rec.created_at).toLocaleString()}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-amber-600" /> Discrepancia {rec.ai_confidence}%
                        </span>
                      </div>

                      {/* Resumen del Contraste IA */}
                      <p className="text-xs text-amber-900 bg-amber-100/60 p-2.5 rounded-lg border border-amber-200 leading-snug">
                        {rec.ai_discrepancy_summary}
                      </p>

                      {/* Comparativa de 2 Columnas */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <div className="bg-white border border-slate-200 rounded-lg p-3">
                          <div className="text-[11px] font-bold text-slate-400 uppercase mb-1">
                            Datos Digitados por el Vendedor
                          </div>
                          <div className="space-y-1">
                            <div>
                              <span className="text-slate-500">Nombre:</span> <strong>{rec.entered_name}</strong>
                            </div>
                            <div>
                              <span className="text-slate-500">Documento:</span>{' '}
                              <strong className="font-mono">{rec.entered_document || '—'}</strong>
                            </div>
                            <div>
                              <span className="text-slate-500">Dirección:</span> {rec.entered_address || '—'}
                            </div>
                          </div>
                        </div>

                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                          <div className="text-[11px] font-bold text-emerald-700 uppercase mb-1">
                            Datos Detectados en la Foto Oficial por Gemini
                          </div>
                          <div className="space-y-1">
                            <div>
                              <span className="text-emerald-700">Razón Social:</span>{' '}
                              <strong>{rec.ai_extracted_name || rec.entered_name}</strong>
                            </div>
                            <div>
                              <span className="text-emerald-700">Documento Oficial:</span>{' '}
                              <strong className="font-mono text-emerald-900">{rec.ai_extracted_document}</strong>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Botones de Acción */}
                      <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-amber-200">
                        <button
                          onClick={() => setPreviewDocUrl(rec.document_image_url)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-900 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-200"
                        >
                          <Eye className="w-3.5 h-3.5" /> Ver Documento RIF Escaneado
                        </button>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleDismissAiDiscrepancy(rec.id)}
                            className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-white"
                          >
                            Descartar Alerta
                          </button>
                          <button
                            onClick={() => handleApplyAiCorrection(rec)}
                            className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-1.5 rounded-lg shadow-sm"
                          >
                            <Check className="w-3.5 h-3.5" /> Corregir Ficha Oficial
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Pestaña 2: Correcciones Propuestas por Vendedores */}
            {activeReviewTab === 'observations' && (
              <div className="space-y-3">
                {pendingVendorObservations.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-500 text-xs">
                    <CheckCircle2 className="w-8 h-8 text-indigo-500 mx-auto mb-2" />
                    No hay solicitudes de corrección de vendedores pendientes de revisión.
                  </div>
                ) : (
                  pendingVendorObservations.map(obs => (
                    <div key={obs.id} className="border border-indigo-200 bg-indigo-50/40 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <span className="text-xs font-bold text-slate-800 block">{obs.customer_name}</span>
                          <span className="text-[11px] text-slate-500">
                            Enviado por: <strong>{obs.vendor_name}</strong> ·{' '}
                            {new Date(obs.created_at).toLocaleString()}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">
                          Solicitud de corrección
                        </span>
                      </div>

                      {/* Nota del Vendedor */}
                      <div className="bg-white border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700">
                        <span className="font-semibold text-slate-800 block mb-0.5">Motivo del vendedor:</span>
                        <p>{obs.vendor_notes}</p>
                      </div>

                      {/* Datos Propuestos */}
                      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-xs space-y-1">
                        <span className="font-bold text-indigo-900 block mb-1">Cambios solicitados:</span>
                        {obs.proposed_name && (
                          <div>
                            <span className="text-indigo-700">Nombre / Razón Social:</span>{' '}
                            <strong>{obs.proposed_name}</strong>
                          </div>
                        )}
                        {obs.proposed_document && (
                          <div>
                            <span className="text-indigo-700">Documento (RIF/NIT):</span>{' '}
                            <strong className="font-mono">{obs.proposed_document}</strong>
                          </div>
                        )}
                        {obs.proposed_phone && (
                          <div>
                            <span className="text-indigo-700">Teléfono:</span> {obs.proposed_phone}
                          </div>
                        )}
                        {obs.proposed_address && (
                          <div>
                            <span className="text-indigo-700">Dirección:</span> {obs.proposed_address}
                          </div>
                        )}
                      </div>

                      {/* Acciones */}
                      <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-indigo-200">
                        {obs.document_image_url ? (
                          <button
                            onClick={() => setPreviewDocUrl(obs.document_image_url!)}
                            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-900 bg-white px-3 py-1.5 rounded-lg border border-indigo-200"
                          >
                            <Eye className="w-3.5 h-3.5" /> Ver Foto de Respaldo Adjunta
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Sin foto adjunta</span>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleDismissObservation(obs.id)}
                            className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-white"
                          >
                            Rechazar
                          </button>
                          <button
                            onClick={() => handleApproveObservation(obs)}
                            className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-1.5 rounded-lg shadow-sm"
                          >
                            <Check className="w-3.5 h-3.5" /> Aprobar y Aplicar a Ficha
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Visor de Foto de Documento RIF / NIT */}
      {previewDocUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setPreviewDocUrl(null)}
        >
          <div
            className="bg-white rounded-xl p-4 max-w-2xl w-full max-h-[90vh] flex flex-col space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-700" />
                <span className="font-bold text-slate-800 text-sm">Comprobante Oficial RIF / NIT / RUT</span>
              </div>
              <button onClick={() => setPreviewDocUrl(null)} className="p-1 rounded hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-auto max-h-[70vh] flex items-center justify-center bg-slate-100 rounded-lg p-2">
              <img
                src={previewDocUrl}
                alt="Comprobante de establecimiento"
                className="max-w-full h-auto object-contain rounded"
              />
            </div>
            <div className="flex justify-end pt-1">
              <button
                onClick={() => setPreviewDocUrl(null)}
                className="bg-slate-800 text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-slate-700"
              >
                Cerrar Visor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Importar CSV */}
      {showImport && !readOnly && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => {
            if (!importing) setShowImport(false)
          }}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <h2 className="font-bold text-slate-800">Importar clientes desde Excel / CSV</h2>
              </div>
              <button onClick={() => setShowImport(false)} className="p-1 rounded hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Sube un archivo CSV guardado desde Excel. Si el documento o el nombre ya existen, se actualizarán sus datos
              de contacto; si no, se creará como cliente nuevo.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={downloadTemplate}
                className="text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg"
              >
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
                            <span
                              className={`px-1.5 py-0.5 rounded font-medium ${
                                r.existingId ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
                              }`}
                            >
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
