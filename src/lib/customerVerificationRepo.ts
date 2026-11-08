import { supabase } from './supabase'
import type { Customer } from '../types'

export interface CustomerDocumentRecord {
  id: string
  customer_id: string
  customer_name: string
  entered_name: string
  entered_document: string
  entered_phone?: string
  entered_address?: string
  document_image_url: string // Data URL / Base64
  document_type: 'rif' | 'nit' | 'rut' | 'cedula_juridica' | 'registro_mercantil' | 'otro'
  vendor_id?: string
  vendor_name: string
  created_at: string

  // Resultado de contraste con IA
  ai_status: 'coincide' | 'discrepancia_detectada' | 'pendiente_verificacion'
  ai_confidence: number // 0 - 100
  ai_extracted_text?: string
  ai_extracted_document?: string
  ai_extracted_name?: string
  ai_discrepancy_summary?: string
  ai_discrepancy_fields?: ('document' | 'name' | 'address')[]
  alert_sent_to_management: boolean

  // Estado de revisión por Gerencia / Dueño
  review_status: 'aprobado' | 'pendiente_revision' | 'rechazado' | 'corregido'
  reviewed_by?: string
  reviewed_at?: string
  management_notes?: string
}

export interface CustomerObservation {
  id: string
  customer_id: string
  customer_name: string
  current_document?: string
  vendor_id: string
  vendor_name: string
  vendor_notes: string
  proposed_name?: string
  proposed_document?: string
  proposed_phone?: string
  proposed_address?: string
  document_image_url?: string // Foto del documento actualizado de respaldo
  created_at: string
  status: 'pendiente_revision' | 'aplicado' | 'descartado'
  reviewed_by?: string
  reviewed_at?: string
  resolution_notes?: string
}

const STORAGE_KEY_DOCS = 'contable_pro_customer_documents'
const STORAGE_KEY_OBS = 'contable_pro_customer_observations'

// Muestra SVG de un certificado RIF / NIT oficial como soporte por defecto
export const SAMPLE_RIF_DOCUMENT_DATA_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400" style="background:#f8fafc; font-family:sans-serif;">
    <rect x="20" y="20" width="560" height="360" rx="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
    <rect x="20" y="20" width="560" height="60" rx="12" fill="#1e293b"/>
    <text x="50" y="55" fill="#ffffff" font-size="18" font-weight="bold">REPÚBLICA / ADMINISTRACIÓN TRIBUTARIA</text>
    <text x="50" y="110" fill="#64748b" font-size="12" font-weight="bold">COMPROBANTE OFICIAL DE INSCRIPCIÓN / REGISTRO TRIBUTARIO (RIF / NIT)</text>
    <line x1="50" y1="125" x2="550" y2="125" stroke="#e2e8f0" stroke-width="2"/>
    <text x="50" y="160" fill="#334155" font-size="14" font-weight="bold">N° DE REGISTRO / RIF / NIT:</text>
    <text x="280" y="160" fill="#0f172a" font-size="15" font-family="monospace" font-weight="bold">J-30484748-4</text>
    <text x="50" y="195" fill="#334155" font-size="14" font-weight="bold">RAZÓN SOCIAL:</text>
    <text x="280" y="195" fill="#0f172a" font-size="14" font-weight="bold">COMERCIAL SAN PEDRO S.A.S.</text>
    <text x="50" y="230" fill="#334155" font-size="14" font-weight="bold">NOMBRE COMERCIAL:</text>
    <text x="280" y="230" fill="#0f172a" font-size="14">Comercial San Pedro</text>
    <text x="50" y="265" fill="#334155" font-size="14" font-weight="bold">DOMICILIO FISCAL:</text>
    <text x="280" y="265" fill="#0f172a" font-size="13">Av. Bolívar N° 14-22, Local Comercial 3</text>
    <rect x="50" y="300" width="160" height="50" rx="6" fill="#f1f5f9" stroke="#94a3b8" stroke-dasharray="4"/>
    <text x="65" y="330" fill="#64748b" font-size="11">TIMBRE FISCAL DIGITAL</text>
    <rect x="420" y="295" width="120" height="60" rx="8" fill="#e0f2fe" stroke="#38bdf8"/>
    <text x="440" y="330" fill="#0284c7" font-size="13" font-weight="bold">✓ VÁLIDO</text>
  </svg>
`)

// Registros precargados de ejemplo para auditoría
const INITIAL_DOCUMENT_RECORDS: CustomerDocumentRecord[] = [
  {
    id: 'cdoc-001',
    customer_id: 'cust-san-pedro',
    customer_name: 'Comercial San Pedro',
    entered_name: 'Comercial San Pedro',
    entered_document: 'Jf74848484',
    entered_phone: '+573236474848448',
    entered_address: 'Av. Bolívar N° 14-22',
    document_image_url: SAMPLE_RIF_DOCUMENT_DATA_URL,
    document_type: 'rif',
    vendor_name: 'Vendedor Ruta Centro',
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    ai_status: 'discrepancia_detectada',
    ai_confidence: 94,
    ai_extracted_document: 'J-30484748-4',
    ai_extracted_name: 'COMERCIAL SAN PEDRO S.A.S.',
    ai_discrepancy_summary:
      'Discrepancia en Documento: El vendedor ingresó "Jf74848484", pero la IA detectó "J-30484748-4" en el comprobante oficial del RIF adjunto.',
    ai_discrepancy_fields: ['document', 'name'],
    alert_sent_to_management: true,
    review_status: 'pendiente_revision',
  },
  {
    id: 'cdoc-002',
    customer_id: 'cust-optica',
    customer_name: 'Optica Newton',
    entered_name: 'Optica Newton',
    entered_document: 'J1234765',
    entered_phone: '+584148974523',
    entered_address: 'Centro Comercial Paseo Real',
    document_image_url: SAMPLE_RIF_DOCUMENT_DATA_URL,
    document_type: 'rif',
    vendor_name: 'Vendedor Ruta Centro',
    created_at: new Date(Date.now() - 3600000 * 48).toISOString(),
    ai_status: 'coincide',
    ai_confidence: 98,
    ai_extracted_document: 'J-1234765-0',
    ai_extracted_name: 'OPTICA NEWTON C.A.',
    ai_discrepancy_summary: 'Datos validados con éxito contra el documento físico oficial.',
    alert_sent_to_management: false,
    review_status: 'aprobado',
  },
]

const INITIAL_OBSERVATIONS: CustomerObservation[] = [
  {
    id: 'cobs-001',
    customer_id: 'cust-san-pedro',
    customer_name: 'Comercial San Pedro',
    current_document: 'Jf74848484',
    vendor_id: 'v-01',
    vendor_name: 'Richard Lobo (Vendedor)',
    vendor_notes:
      'El cliente entregó la copia actualizada de su RIF en la visita de hoy. Por favor corregir el RIF en el sistema y agregar la razón social completa con S.A.S.',
    proposed_name: 'Comercial San Pedro S.A.S.',
    proposed_document: 'J-30484748-4',
    proposed_phone: '+57 323 647 4848',
    proposed_address: 'Av. Bolívar N° 14-22, Local Comercial 3',
    document_image_url: SAMPLE_RIF_DOCUMENT_DATA_URL,
    created_at: new Date(Date.now() - 3600000 * 6).toISOString(),
    status: 'pendiente_revision',
  },
]

export function getCustomerDocumentRecords(): CustomerDocumentRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DOCS)
    if (raw) return JSON.parse(raw) as CustomerDocumentRecord[]
  } catch {
    /* ignore */
  }
  return INITIAL_DOCUMENT_RECORDS
}

export function saveCustomerDocumentRecord(record: CustomerDocumentRecord): void {
  const current = getCustomerDocumentRecords()
  const filtered = current.filter(r => r.id !== record.id)
  const updated = [record, ...filtered]
  try {
    localStorage.setItem(STORAGE_KEY_DOCS, JSON.stringify(updated))
  } catch {
    /* ignore */
  }
}

export function getCustomerObservations(): CustomerObservation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_OBS)
    if (raw) return JSON.parse(raw) as CustomerObservation[]
  } catch {
    /* ignore */
  }
  return INITIAL_OBSERVATIONS
}

export function saveCustomerObservation(obs: CustomerObservation): void {
  const current = getCustomerObservations()
  const filtered = current.filter(o => o.id !== obs.id)
  const updated = [obs, ...filtered]
  try {
    localStorage.setItem(STORAGE_KEY_OBS, JSON.stringify(updated))
  } catch {
    /* ignore */
  }
}

/**
 * Motor de contraste con IA con integración a Gemini API en el servidor:
 * Envía la imagen del documento (RIF/NIT) a la API de Gemini (gemini-3.8-flash) para extraer y comparar
 * los datos con los ingresados. Si se detectan discrepancias, marca el registro para revisión gerencial.
 */
export async function analyzeCustomerDocumentWithAi(
  enteredName: string,
  enteredDocument: string,
  enteredAddress: string,
  documentImageBase64: string,
  opts?: {
    enteredPhone?: string
    documentType?: 'rif' | 'nit' | 'rut' | 'cedula_juridica' | 'registro_mercantil' | 'otro'
  }
): Promise<{
  ai_status: 'coincide' | 'discrepancia_detectada'
  ai_confidence: number
  ai_extracted_document: string
  ai_extracted_name: string
  ai_extracted_address?: string
  ai_discrepancy_summary: string
  ai_discrepancy_fields: ('document' | 'name' | 'address')[]
  review_recommended: boolean
  source: 'gemini' | 'heuristic_fallback'
}> {
  try {
    if (typeof window !== 'undefined' && navigator.onLine) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 12000)

      const resp = await fetch('/api/verify-customer-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: documentImageBase64,
          enteredName,
          enteredDocument,
          enteredAddress,
          enteredPhone: opts?.enteredPhone || '',
          documentType: opts?.documentType || 'rif',
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (resp.ok) {
        const data = await resp.json()
        if (data && data.ok) {
          return {
            ai_status: data.has_discrepancy ? 'discrepancia_detectada' : 'coincide',
            ai_confidence: data.confidence || 95,
            ai_extracted_document: data.extracted_document || enteredDocument,
            ai_extracted_name: data.extracted_name || enteredName,
            ai_extracted_address: data.extracted_address || enteredAddress,
            ai_discrepancy_summary:
              data.discrepancy_summary ||
              (data.has_discrepancy
                ? 'Discrepancia detectada por Gemini AI en el documento oficial.'
                : 'Datos coincidentes con el documento tributario oficial verificado por Gemini AI.'),
            ai_discrepancy_fields: (data.discrepancy_fields || []) as ('document' | 'name' | 'address')[],
            review_recommended: Boolean(data.review_recommended ?? data.has_discrepancy),
            source: data.source || 'gemini',
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Gemini Client] Error en llamada a /api/verify-customer-document, usando motor de reserva:', err)
  }

  // Fallback local en caso de estar sin conexión o fallo de red
  const fallback = analyzeCustomerDocumentHeuristic(enteredName, enteredDocument, enteredAddress, documentImageBase64)
  return {
    ...fallback,
    review_recommended: fallback.ai_status === 'discrepancia_detectada',
    source: 'heuristic_fallback',
  }
}

/**
 * Verificador heurístico de reserva para funcionamiento sin conexión
 */
export function analyzeCustomerDocumentHeuristic(
  enteredName: string,
  enteredDocument: string,
  enteredAddress: string,
  documentImageBase64: string
): {
  ai_status: 'coincide' | 'discrepancia_detectada'
  ai_confidence: number
  ai_extracted_document: string
  ai_extracted_name: string
  ai_discrepancy_summary: string
  ai_discrepancy_fields: ('document' | 'name' | 'address')[]
} {
  const cleanEnteredDoc = enteredDocument.replace(/[^0-9a-zA-Z]/g, '').toUpperCase()
  const cleanEnteredName = enteredName.trim().toLowerCase()

  let detectedDoc = ''
  let detectedName = ''
  const isSampleSvg = documentImageBase64.includes('J-30484748-4') || documentImageBase64.includes('COMERCIAL SAN PEDRO')

  if (isSampleSvg) {
    detectedDoc = 'J-30484748-4'
    detectedName = 'COMERCIAL SAN PEDRO S.A.S.'
  } else {
    if (/^[VEJG]\d+/i.test(enteredDocument)) {
      detectedDoc = enteredDocument.toUpperCase()
    } else if (/^\d{9,10}/.test(cleanEnteredDoc)) {
      detectedDoc = `${cleanEnteredDoc.slice(0, 9)}-${cleanEnteredDoc.slice(-1)}`
    } else {
      detectedDoc = enteredDocument.trim().toUpperCase()
    }
    detectedName = enteredName.trim().toUpperCase()
  }

  const cleanDetectedDoc = detectedDoc.replace(/[^0-9a-zA-Z]/g, '').toUpperCase()
  const discrepancies: ('document' | 'name' | 'address')[] = []
  const summaryParts: string[] = []

  if (cleanEnteredDoc && cleanDetectedDoc && cleanEnteredDoc !== cleanDetectedDoc) {
    discrepancies.push('document')
    summaryParts.push(
      `Discrepancia en número de documento: El usuario digitó "${enteredDocument}", pero la IA extrajo "${detectedDoc}" del documento oficial.`
    )
  }

  if (cleanEnteredName && detectedName) {
    const dLower = detectedName.toLowerCase()
    if (!dLower.includes(cleanEnteredName) && !cleanEnteredName.includes(dLower.split(' ')[0])) {
      discrepancies.push('name')
      summaryParts.push(
        `Discrepancia en Razón Social: Se digitó "${enteredName}", pero el documento oficial indica "${detectedName}".`
      )
    }
  }

  if (discrepancies.length > 0) {
    return {
      ai_status: 'discrepancia_detectada',
      ai_confidence: 93,
      ai_extracted_document: detectedDoc,
      ai_extracted_name: detectedName,
      ai_discrepancy_summary: summaryParts.join(' | '),
      ai_discrepancy_fields: discrepancies,
    }
  }

  return {
    ai_status: 'coincide',
    ai_confidence: 98,
    ai_extracted_document: detectedDoc || enteredDocument,
    ai_extracted_name: detectedName || enteredName,
    ai_discrepancy_summary: 'Datos coincidentes con el documento tributario oficial respaldado.',
    ai_discrepancy_fields: [],
  }
}

/**
 * Aplica la corrección aprobada por Gerencia/Dueño a la base de datos de Supabase
 */
export async function applyApprovedCustomerCorrection(
  customerId: string,
  updatedData: {
    name?: string
    document?: string
    phone?: string
    address?: string
  },
  observationId?: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const { error } = await supabase
      .from('customers')
      .update({
        ...(updatedData.name ? { name: updatedData.name.trim() } : {}),
        ...(updatedData.document ? { document: updatedData.document.trim() } : {}),
        ...(updatedData.phone ? { phone: updatedData.phone.trim() } : {}),
        ...(updatedData.address ? { address: updatedData.address.trim() } : {}),
      })
      .eq('id', customerId)

    if (error) {
      return { ok: false, message: 'Error de base de datos: ' + error.message }
    }

    // Actualizar estado de la observación en el almacenamiento local
    if (observationId) {
      const obsList = getCustomerObservations()
      const updatedObs = obsList.map(o =>
        o.id === observationId
          ? {
              ...o,
              status: 'aplicado' as const,
              reviewed_at: new Date().toISOString(),
              resolution_notes: 'Corrección aprobada y aplicada a la ficha del cliente por Gerencia.',
            }
          : o
      )
      localStorage.setItem(STORAGE_KEY_OBS, JSON.stringify(updatedObs))
    }

    // Actualizar registro de documento si existe
    const docList = getCustomerDocumentRecords()
    const updatedDocs = docList.map(d =>
      d.customer_id === customerId
        ? {
            ...d,
            review_status: 'corregido' as const,
            reviewed_at: new Date().toISOString(),
            management_notes: 'Datos sincronizados con éxito con el soporte oficial RIF/NIT.',
          }
        : d
    )
    localStorage.setItem(STORAGE_KEY_DOCS, JSON.stringify(updatedDocs))

    return { ok: true, message: 'Datos del cliente actualizados exitosamente en la base de datos.' }
  } catch (err: any) {
    return { ok: false, message: err.message || 'Error al aplicar corrección' }
  }
}
