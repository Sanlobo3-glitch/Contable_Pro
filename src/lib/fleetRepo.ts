import type { FleetVehicle, VehicleMaintenanceRecord, InventoryTransfer } from '../types'
import { supabase } from './supabase'

const FLEET_STORAGE_KEY = 'contable_pro_fleet_vehicles'
const MAINT_STORAGE_KEY = 'contable_pro_vehicle_maintenance'
const TRANSFERS_EXT_KEY = 'contable_pro_transfers_enrichment'

export const DEFAULT_WAREHOUSE_COORDINATES: Record<string, { lat: number; lng: number; label: string }> = {
  'wh-demo-1': { lat: 4.678, lng: -74.125, label: 'Bodega Principal Mayorista (Zona Occidente)' },
  'wh-demo-2': { lat: 4.6097, lng: -74.0817, label: 'Almacén Piso de Venta Centro' },
  'wh-demo-3': { lat: 4.745, lng: -74.043, label: 'Bodega Despacho Ruta Norte' },
  'wh-demo-4': { lat: 4.6795, lng: -74.1265, label: 'Área de Control y Devoluciones' },
}

export function getWarehouseCoords(warehouseId: string): { lat: number; lng: number } {
  if (DEFAULT_WAREHOUSE_COORDINATES[warehouseId]) {
    return DEFAULT_WAREHOUSE_COORDINATES[warehouseId]
  }
  // Generar coordenadas deterministas cercanas a la zona metropolitana si es una bodega creada por el usuario
  let hash = 0
  for (let i = 0; i < warehouseId.length; i++) {
    hash = (hash << 5) - hash + warehouseId.charCodeAt(i)
    hash |= 0
  }
  const deltaLat = ((Math.abs(hash) % 100) - 50) / 1000
  const deltaLng = ((Math.abs(hash >> 2) % 100) - 50) / 1000
  return { lat: 4.65 + deltaLat, lng: -74.08 + deltaLng }
}

const DEFAULT_FLEET_VEHICLES: FleetVehicle[] = [
  {
    id: 'veh-1',
    company_id: 'c-demo-1',
    name: 'Camión Chevrolet NPR Turbo 4.5T',
    plate: 'WDF-892',
    brand_model: 'Chevrolet NPR 2024 Euro VI',
    vehicle_type: 'camion',
    capacity_kg: 4500,
    capacity_m3: 18.5,
    odometer_km: 38450,
    warehouse_id: 'wh-demo-1',
    warehouse_name: 'Bodega Principal Mayorista',
    driver_name: 'Carlos Alberto Mendoza',
    driver_phone: '+57 312 849 2011',
    driver_license: 'C2 - Vigente hasta 2028',
    dispatcher_name: 'Javier Ortiz (Auxiliar Despacho)',
    status: 'en_ruta',
    soat_expires_at: '2027-04-15',
    rtm_expires_at: '2027-02-28',
    insurance_policy: 'Seguros del Estado Póliza Colectiva #7784-01',
    last_maintenance_at: '2026-09-12',
    next_maintenance_km: 40000,
    current_lat: 4.645,
    current_lng: -74.095,
    last_gps_at: new Date(Date.now() - 4 * 60000).toISOString(),
    is_gps_active: true,
    notes: 'Dotado con sistema GPS satelital, compuerta hidráulica y rastreador en cabina.',
    created_at: new Date(Date.now() - 90 * 86400000).toISOString(),
  },
  {
    id: 'veh-2',
    company_id: 'c-demo-1',
    name: 'Furgón NHR Refrigerado Cadena Frío',
    plate: 'TLK-431',
    brand_model: 'Chevrolet NHR ThermoKing 2023',
    vehicle_type: 'furgon_frio',
    capacity_kg: 2800,
    capacity_m3: 11.2,
    odometer_km: 54120,
    warehouse_id: 'wh-demo-1',
    warehouse_name: 'Bodega Principal Mayorista',
    driver_name: 'Mauricio Gómez Peña',
    driver_phone: '+57 315 720 9944',
    driver_license: 'C2 - Vigente hasta 2027',
    dispatcher_name: 'Luis Beltrán',
    status: 'operativo',
    soat_expires_at: '2027-06-20',
    rtm_expires_at: '2027-05-10',
    insurance_policy: 'Allianz Todo Riesgo Transporte #99214-B',
    last_maintenance_at: '2026-10-04',
    next_maintenance_km: 55000,
    current_lat: 4.678,
    current_lng: -74.125,
    last_gps_at: new Date(Date.now() - 15 * 60000).toISOString(),
    is_gps_active: false,
    notes: 'Equipado con termógrafo digital calibrado para transporte de perecederos (-18°C a 4°C).',
    created_at: new Date(Date.now() - 120 * 86400000).toISOString(),
  },
  {
    id: 'veh-3',
    company_id: 'c-demo-1',
    name: 'Camioneta Reparto Rápido D-Max',
    plate: 'JHY-628',
    brand_model: 'Isuzu D-Max 4x4 Diésel 2022',
    vehicle_type: 'camioneta',
    capacity_kg: 1100,
    capacity_m3: 4.5,
    odometer_km: 89300,
    warehouse_id: 'wh-demo-3',
    warehouse_name: 'Bodega Despacho Ruta Norte',
    driver_name: 'Hernando Silva',
    driver_phone: '+57 320 411 7890',
    driver_license: 'C1 - Vigente hasta 2029',
    dispatcher_name: 'Andrés Felipe Cruz',
    status: 'operativo',
    soat_expires_at: '2026-12-15', // Alerta próximo a vencer
    rtm_expires_at: '2027-01-18',
    insurance_policy: 'Sura Carga Liviana #4421-99',
    last_maintenance_at: '2026-08-20',
    next_maintenance_km: 90000,
    current_lat: 4.745,
    current_lng: -74.043,
    last_gps_at: new Date(Date.now() - 2 * 60000).toISOString(),
    is_gps_active: true,
    notes: 'Vehículo ágil para entregas express en el corredor norte de la ciudad.',
    created_at: new Date(Date.now() - 150 * 86400000).toISOString(),
  },
  {
    id: 'veh-4',
    company_id: 'c-demo-1',
    name: 'Furgón Hino Dutro City 5.0T',
    plate: 'SKL-904',
    brand_model: 'Hino Dutro City 300 2021',
    vehicle_type: 'camion',
    capacity_kg: 5000,
    capacity_m3: 22.0,
    odometer_km: 112400,
    warehouse_id: 'wh-demo-1',
    warehouse_name: 'Bodega Principal Mayorista',
    driver_name: 'Ricardo Montero',
    driver_phone: '+57 311 559 3422',
    driver_license: 'C3 - Vigente hasta 2028',
    dispatcher_name: 'Álvaro Prieto',
    status: 'en_taller',
    soat_expires_at: '2027-03-01',
    rtm_expires_at: '2027-03-01',
    insurance_policy: 'Equidad Seguros #88123-X',
    last_maintenance_at: '2026-11-01',
    next_maintenance_km: 115000,
    current_lat: 4.652,
    current_lng: -74.11,
    last_gps_at: new Date(Date.now() - 120 * 60000).toISOString(),
    is_gps_active: false,
    notes: 'En mantenimiento correctivo de sistema de suspensión y frenos en Taller Central.',
    created_at: new Date(Date.now() - 200 * 86400000).toISOString(),
  },
]

const DEFAULT_MAINTENANCE_RECORDS: VehicleMaintenanceRecord[] = [
  {
    id: 'maint-1',
    vehicle_id: 'veh-1',
    maintenance_type: 'cambio_aceite',
    description: 'Cambio de aceite sintético 15W40 + filtros de combustible primario, secundario y filtro de aire.',
    cost: 485000,
    odometer_km: 35000,
    performed_at: '2026-09-12',
    workshop_name: 'Lubricantes y Filtros del Centro S.A.S.',
    performed_by: 'Mecánico Certificado J. Rodríguez',
    next_due_date: '2027-03-12',
    next_due_km: 40000,
  },
  {
    id: 'maint-2',
    vehicle_id: 'veh-1',
    maintenance_type: 'frenos',
    description: 'Sustitución de pastillas de freno delanteras, rectificación de campanas traseras y purga de líquido DOT 4.',
    cost: 650000,
    odometer_km: 32100,
    performed_at: '2026-07-28',
    workshop_name: 'Frenos y Embragues La 26',
    performed_by: 'Técnico Especialista M. Santos',
    next_due_date: '2027-01-28',
    next_due_km: 42000,
  },
  {
    id: 'maint-3',
    vehicle_id: 'veh-2',
    maintenance_type: 'revision_general',
    description: 'Mantenimiento preventivo unidad refrigerante ThermoKing, recarga gas R404A y verificación de empaques isotérmicos.',
    cost: 1250000,
    odometer_km: 52000,
    performed_at: '2026-10-04',
    workshop_name: 'ThermoCold Soluciones Frías',
    performed_by: 'Ing. Carlos Pardo',
    next_due_date: '2027-04-04',
    next_due_km: 60000,
  },
  {
    id: 'maint-4',
    vehicle_id: 'veh-4',
    maintenance_type: 'correctivo',
    description: 'Reparación de muelles traseros reforzados, amortiguadores y alineación láser del tren delantero.',
    cost: 1850000,
    odometer_km: 112400,
    performed_at: '2026-11-01',
    workshop_name: 'Taller Autorizado Hino Camiones',
    performed_by: 'Jefe de Taller D. Rincón',
    next_due_date: '2027-05-01',
    next_due_km: 120000,
  },
]

export function getFleetVehicles(): FleetVehicle[] {
  try {
    const raw = localStorage.getItem(FLEET_STORAGE_KEY)
    if (!raw) {
      localStorage.setItem(FLEET_STORAGE_KEY, JSON.stringify(DEFAULT_FLEET_VEHICLES))
      return DEFAULT_FLEET_VEHICLES
    }
    return JSON.parse(raw) as FleetVehicle[]
  } catch {
    return DEFAULT_FLEET_VEHICLES
  }
}

export function saveFleetVehicle(vehicle: FleetVehicle): FleetVehicle[] {
  const list = getFleetVehicles()
  const exists = list.some(v => v.id === vehicle.id)
  const updated = exists ? list.map(v => (v.id === vehicle.id ? vehicle : v)) : [vehicle, ...list]
  try {
    localStorage.setItem(FLEET_STORAGE_KEY, JSON.stringify(updated))
  } catch (e) {
    console.error('Error saving fleet vehicle to localStorage:', e)
  }
  return updated
}

export function deleteFleetVehicle(vehicleId: string): FleetVehicle[] {
  const list = getFleetVehicles().filter(v => v.id !== vehicleId)
  try {
    localStorage.setItem(FLEET_STORAGE_KEY, JSON.stringify(list))
  } catch (e) {
    console.error('Error deleting fleet vehicle:', e)
  }
  return list
}

export function getVehicleMaintenanceRecords(vehicleId?: string): VehicleMaintenanceRecord[] {
  try {
    const raw = localStorage.getItem(MAINT_STORAGE_KEY)
    const list: VehicleMaintenanceRecord[] = raw ? JSON.parse(raw) : DEFAULT_MAINTENANCE_RECORDS
    if (!raw) {
      localStorage.setItem(MAINT_STORAGE_KEY, JSON.stringify(DEFAULT_MAINTENANCE_RECORDS))
    }
    if (vehicleId) {
      return list.filter(m => m.vehicle_id === vehicleId)
    }
    return list
  } catch {
    return DEFAULT_MAINTENANCE_RECORDS
  }
}

export function saveVehicleMaintenanceRecord(record: VehicleMaintenanceRecord): VehicleMaintenanceRecord[] {
  const list = getVehicleMaintenanceRecords()
  const exists = list.some(m => m.id === record.id)
  const updated = exists ? list.map(m => (m.id === record.id ? record : m)) : [record, ...list]
  try {
    localStorage.setItem(MAINT_STORAGE_KEY, JSON.stringify(updated))
  } catch (e) {
    console.error('Error saving maintenance record:', e)
  }
  return updated
}

// ============================================================================
// TRANSFER LOGISTICS ENRICHMENT
// ============================================================================

export type TransferEnrichment = Partial<InventoryTransfer>

export function getTransferEnrichmentMap(): Record<string, TransferEnrichment> {
  try {
    const raw = localStorage.getItem(TRANSFERS_EXT_KEY)
    const map: Record<string, TransferEnrichment> = raw ? JSON.parse(raw) : {}
    // Valores predeterminados para las transferencias demo si no existen
    if (!map['trf-demo-1']) {
      map['trf-demo-1'] = {
        vehicle_id: 'veh-1',
        vehicle_plate: 'WDF-892',
        vehicle_name: 'Camión Chevrolet NPR Turbo 4.5T',
        driver_name: 'Carlos Alberto Mendoza',
        driver_phone: '+57 312 849 2011',
        driver_license: 'C2 - Vigente hasta 2028',
        dispatcher_name: 'Javier Ortiz (Auxiliar Despacho)',
        last_lat: 4.645,
        last_lng: -74.095,
        last_gps_updated_at: new Date(Date.now() - 3 * 60000).toISOString(),
        live_tracking_active: true,
        estimated_duration_min: 28,
        distance_km: 11.4,
      }
    }
    if (!map['trf-demo-2']) {
      map['trf-demo-2'] = {
        vehicle_id: 'veh-2',
        vehicle_plate: 'TLK-431',
        vehicle_name: 'Furgón NHR Refrigerado Cadena Frío',
        driver_name: 'Mauricio Gómez Peña',
        driver_phone: '+57 315 720 9944',
        driver_license: 'C2 - Vigente hasta 2027',
        dispatcher_name: 'Luis Beltrán',
        receiver_name: 'Marta Cecilia Domínguez',
        receiver_document: 'CC 52.894.102',
        received_condition: 'conforme',
        delivery_proof_signature: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><path d="M20,60 Q60,10 100,50 T180,30" fill="none" stroke="%230f172a" stroke-width="3"/></svg>',
        delivery_confirmation_sent: true,
        delivery_confirmation_email: 'supervisor.ruta@contablepro.com',
        delivery_confirmation_whatsapp: '+57 310 998 8776',
        physical_dispatch_note_name: 'Remision_Firmada_TR018.pdf',
        physical_dispatch_note_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500"><rect width="100%" height="100%" fill="%23f8fafc"/><text x="20" y="40" font-family="sans-serif" font-size="16" font-weight="bold" fill="%230f172a">REMISIÓN DE TRASLADO FISICA #TR-018</text><text x="20" y="70" font-family="sans-serif" font-size="12" fill="%2364748b">Firma y Sello de Recibido en Destino Conforme</text><circle cx="320" cy="400" r="45" fill="none" stroke="%232563eb" stroke-width="3"/><text x="285" y="405" font-family="sans-serif" font-size="10" font-weight="bold" fill="%232563eb">SELLO RECIBIDO</text></svg>',
        physical_dispatch_note_date: new Date(Date.now() - 48 * 3600000).toISOString(),
        distance_km: 18.2,
      }
    }
    return map
  } catch {
    return {}
  }
}

export function saveTransferEnrichment(transferId: string, enrichment: TransferEnrichment): void {
  const map = getTransferEnrichmentMap()
  map[transferId] = { ...(map[transferId] || {}), ...enrichment }
  try {
    localStorage.setItem(TRANSFERS_EXT_KEY, JSON.stringify(map))
  } catch (e) {
    console.error('Error saving transfer enrichment:', e)
  }
}

export function enrichTransfer(trf: InventoryTransfer): InventoryTransfer {
  const map = getTransferEnrichmentMap()
  const extra = map[trf.id] || {}
  return {
    ...trf,
    ...extra,
  }
}

export function updateTransferGpsPosition(
  transferId: string,
  lat: number,
  lng: number,
  vehicleId?: string | null
): void {
  const now = new Date().toISOString()
  saveTransferEnrichment(transferId, {
    last_lat: lat,
    last_lng: lng,
    last_gps_updated_at: now,
    live_tracking_active: true,
  })

  // Actualizar también la posición en el vehículo de la flota si está vinculado
  if (vehicleId) {
    const vehicles = getFleetVehicles()
    const target = vehicles.find(v => v.id === vehicleId)
    if (target) {
      saveFleetVehicle({
        ...target,
        current_lat: lat,
        current_lng: lng,
        last_gps_at: now,
        is_gps_active: true,
        status: 'en_ruta',
      })
    }
  }
}
