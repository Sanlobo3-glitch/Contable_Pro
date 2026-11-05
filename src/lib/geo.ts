import { supabase } from './supabase'

export type GpsStatus = 'ok' | 'denied' | 'unavailable'
export interface GeoResult { status: GpsStatus; lat?: number; lng?: number; accuracy?: number }

/** Pide la ubicación al teléfono (alta precisión, 15 s de espera). */
export function getPosition(timeoutMs = 15000): Promise<GeoResult> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve({ status: 'unavailable' }); return }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ status: 'ok', lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      err => resolve({ status: err.code === 1 ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    )
  })
}

export interface VisitCheckResult {
  gps_status: GpsStatus
  lat: number | null
  lng: number | null
  accuracy: number | null
  at_establishment: boolean | null
  note: string
}

/** Formato que reciben las funciones del servidor (jsonb). */
export function geoPayload(check: VisitCheckResult) {
  return {
    gps_status: check.gps_status,
    lat: check.lat,
    lng: check.lng,
    accuracy: check.accuracy,
    at_establishment: check.at_establishment,
    note: check.note,
  }
}

/** Visita sin venta (ej. "visité y no compró"). Devuelve el error o null si salió bien. */
export async function recordVisit(customerId: string | null, check: VisitCheckResult): Promise<string | null> {
  const { error } = await supabase.rpc('registrar_visita', {
    p_customer_id: customerId,
    p_geo: geoPayload(check),
  })
  return error ? error.message : null
}
