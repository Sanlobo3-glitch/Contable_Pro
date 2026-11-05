import { supabase } from './supabase'
import type { CpaProfessionalProfile } from '../types'

const CPA_PROFILE_LOCAL_PREFIX = 'ip_cpa_profile_v1_'
const CPA_WP_LOCAL_PREFIX = 'ip_cpa_wp_v1_'

export interface CpaWorkingPaperRecord {
  period_ym: string
  checklist: Record<string, boolean>
  audit_notes: string
  cpa_profile: CpaProfessionalProfile
  updated_at: string
}

export const DEFAULT_CPA_PROFILE: CpaProfessionalProfile = {
  full_name: '',
  license_number: '',
  firm_name: '',
  title_label: 'Contador Público Colegiado',
  phone: '',
  email: '',
}

export const CPA_AUDIT_CHECKLIST_ITEMS: {
  id: string
  title: string
  detail: string
}[] = [
  {
    id: 'arqueos_caja',
    title: 'Arqueos de caja y fondos fijos verificados',
    detail: 'Saldos de efectivo conciliados contra cierres diarios y comprobantes manuales.',
  },
  {
    id: 'bancos_conciliados',
    title: 'Movimientos bancarios y transferencias conciliados',
    detail: 'Cobros por punto, transferencias y pagos a proveedores validados en libros.',
  },
  {
    id: 'kardex_inventario',
    title: 'Existencias del Kardex vs. Inventario contable (Costo promedio)',
    detail: 'Entradas por compras, salidas por costo de ventas y ajustes sin saldos negativos.',
  },
  {
    id: 'cartera_cxp',
    title: 'Auxiliares de Cartera (CxC) y Proveedores (CxP) cuadrados',
    detail: 'Antigüedad de saldos revisada y abonos aplicados a sus documentos origen.',
  },
  {
    id: 'iva_auxiliares',
    title: 'Cédula tributaria e IVA Débito / Soportado revisada',
    detail: 'Bases imponibles, alícuotas, exentos y devoluciones del período verificados.',
  },
  {
    id: 'ajustes_depreciacion',
    title: 'Asientos de ajuste, nómina y provisiones registrados',
    detail: 'Gastos acumulados, comisiones del equipo y ajustes mensuales contabilizados.',
  },
  {
    id: 'mayor_cuadrado',
    title: 'Partida doble cuadrada y cero asientos en borrador',
    detail: 'Hoja de trabajo de 8 columnas equilibrada al céntimo en sumas y saldos.',
  },
  {
    id: 'estados_emitidos',
    title: 'Estados financieros emitidos y firmados para gerencia',
    detail: 'Estado de Resultados y Estado de Situación Financiera revisados.',
  },
]

function profileKey(companyId: string | null | undefined): string {
  return `${CPA_PROFILE_LOCAL_PREFIX}${companyId || 'default'}`
}

function wpKey(companyId: string | null | undefined, periodYm: string): string {
  return `${CPA_WP_LOCAL_PREFIX}${companyId || 'default'}_${periodYm}`
}

export function readLocalCpaProfile(
  companyId: string | null | undefined,
  fallbackUser?: { full_name?: string; email?: string; phone?: string | null }
): CpaProfessionalProfile {
  try {
    const raw = localStorage.getItem(profileKey(companyId))
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CpaProfessionalProfile>
      return {
        full_name: parsed.full_name ?? '',
        license_number: parsed.license_number ?? '',
        firm_name: parsed.firm_name ?? '',
        title_label: parsed.title_label || 'Contador Público Colegiado',
        phone: parsed.phone ?? '',
        email: parsed.email ?? '',
      }
    }
  } catch {
    /* ignore */
  }

  return {
    ...DEFAULT_CPA_PROFILE,
    full_name: fallbackUser?.full_name || '',
    email: fallbackUser?.email || '',
    phone: fallbackUser?.phone || '',
  }
}

export function writeLocalCpaProfile(
  companyId: string | null | undefined,
  profile: CpaProfessionalProfile
): void {
  try {
    localStorage.setItem(profileKey(companyId), JSON.stringify(profile))
  } catch {
    /* ignore */
  }
}

export async function loadCpaWorkingPaper(
  companyId: string | null | undefined,
  periodYm: string,
  fallbackUser?: { full_name?: string; email?: string; phone?: string | null }
): Promise<CpaWorkingPaperRecord> {
  const localProfile = readLocalCpaProfile(companyId, fallbackUser)

  let localRecord: Partial<CpaWorkingPaperRecord> | null = null
  try {
    const raw = localStorage.getItem(wpKey(companyId, periodYm))
    if (raw) localRecord = JSON.parse(raw) as Partial<CpaWorkingPaperRecord>
  } catch {
    /* ignore */
  }

  if (companyId) {
    try {
      const { data, error } = await supabase
        .from('cpa_working_papers')
        .select('*')
        .eq('company_id', companyId)
        .eq('period_ym', periodYm)
        .maybeSingle()

      if (!error && data) {
        const row = data as {
          checklist?: Record<string, boolean>
          audit_notes?: string | null
          cpa_profile?: Partial<CpaProfessionalProfile> | null
          updated_at?: string
        }
        const mergedProfile: CpaProfessionalProfile = {
          ...localProfile,
          ...(row.cpa_profile || {}),
          title_label:
            row.cpa_profile?.title_label ||
            localProfile.title_label ||
            'Contador Público Colegiado',
        }
        writeLocalCpaProfile(companyId, mergedProfile)
        const result: CpaWorkingPaperRecord = {
          period_ym: periodYm,
          checklist: row.checklist || localRecord?.checklist || {},
          audit_notes: row.audit_notes ?? localRecord?.audit_notes ?? '',
          cpa_profile: mergedProfile,
          updated_at: row.updated_at || new Date().toISOString(),
        }
        try {
          localStorage.setItem(wpKey(companyId, periodYm), JSON.stringify(result))
        } catch {
          /* ignore */
        }
        return result
      }
    } catch {
      /* tabla aún no instalada: usa respaldo local transparente */
    }
  }

  return {
    period_ym: periodYm,
    checklist: localRecord?.checklist || {},
    audit_notes: localRecord?.audit_notes || '',
    cpa_profile: localRecord?.cpa_profile
      ? { ...localProfile, ...localRecord.cpa_profile }
      : localProfile,
    updated_at: localRecord?.updated_at || new Date().toISOString(),
  }
}

export async function saveCpaWorkingPaper(
  companyId: string | null | undefined,
  userId: string | null | undefined,
  record: CpaWorkingPaperRecord
): Promise<{ syncedRemote: boolean }> {
  const updated: CpaWorkingPaperRecord = {
    ...record,
    updated_at: new Date().toISOString(),
  }

  writeLocalCpaProfile(companyId, updated.cpa_profile)
  try {
    localStorage.setItem(wpKey(companyId, updated.period_ym), JSON.stringify(updated))
  } catch {
    /* ignore */
  }

  if (!companyId) return { syncedRemote: false }

  try {
    const { error } = await supabase.from('cpa_working_papers').upsert(
      {
        company_id: companyId,
        period_ym: updated.period_ym,
        checklist: updated.checklist,
        audit_notes: updated.audit_notes,
        cpa_profile: updated.cpa_profile,
        updated_by: userId || null,
        updated_at: updated.updated_at,
      },
      { onConflict: 'company_id,period_ym' }
    )
    return { syncedRemote: !error }
  } catch {
    return { syncedRemote: false }
  }
}
