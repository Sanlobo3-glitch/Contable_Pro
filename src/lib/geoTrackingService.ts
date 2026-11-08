import { getFleetVehicles, saveFleetVehicle, getWarehouseCoords } from './fleetRepo'
import type { FleetVehicle } from '../types'

export interface GpsBreadcrumbPoint {
  lat: number
  lng: number
  speed_kmh: number
  heading?: number
  altitude?: number
  accuracy_m?: number
  timestamp: string
}

export interface RouteStopEvent {
  id: string
  lat: number
  lng: number
  location_name: string
  arrival_time: string
  departure_time: string
  duration_min: number
  kind: 'entrega' | 'combustible' | 'bodega' | 'pausa_almuerzo' | 'transito_lento'
  notes?: string
}

export interface VehicleRouteHistory {
  id: string
  vehicle_id: string
  vehicle_plate: string
  vehicle_name: string
  driver_name: string
  date: string // YYYY-MM-DD
  start_time: string
  end_time?: string
  status: 'en_curso' | 'completada'
  total_distance_km: number
  avg_speed_kmh: number
  max_speed_kmh: number
  moving_time_min: number
  stopped_time_min: number
  origin_name: string
  destination_name?: string
  points: GpsBreadcrumbPoint[]
  stops: RouteStopEvent[]
}

const HISTORIES_STORAGE_KEY = 'contable_pro_vehicle_route_histories'

// Generador de coordenadas y horas para trayectos realistas
function generateMockRoutePoints(
  startLat: number,
  startLng: number,
  waypoints: { lat: number; lng: number; label: string; stopMin?: number }[],
  baseDate: string,
  startHour: number
): { points: GpsBreadcrumbPoint[]; stops: RouteStopEvent[]; distanceKm: number; avgSpeed: number; maxSpeed: number } {
  const points: GpsBreadcrumbPoint[] = []
  const stops: RouteStopEvent[] = []
  let curLat = startLat
  let curLng = startLng
  let curMinute = startHour * 60
  let totalDist = 0
  let maxSpeed = 45

  // Punto inicial
  const startTimeIso = new Date(`${baseDate}T${String(Math.floor(curMinute / 60)).padStart(2, '0')}:${String(curMinute % 60).padStart(2, '0')}:00`).toISOString()
  points.push({
    lat: curLat,
    lng: curLng,
    speed_kmh: 0,
    heading: 90,
    timestamp: startTimeIso,
    accuracy_m: 5,
  })

  stops.push({
    id: `stop-start-${Math.random()}`,
    lat: curLat,
    lng: curLng,
    location_name: 'Salida de Bodega Base',
    arrival_time: startTimeIso,
    departure_time: new Date(new Date(startTimeIso).getTime() + 15 * 60000).toISOString(),
    duration_min: 15,
    kind: 'bodega',
    notes: 'Cargue y despacho de mercancía verificado con remisión.',
  })
  curMinute += 15

  waypoints.forEach((wp, wIdx) => {
    // Generar puntos intermedios entre la posición actual y el waypoint
    const steps = 8
    const dLat = (wp.lat - curLat) / steps
    const dLng = (wp.lng - curLng) / steps

    for (let s = 1; s <= steps; s++) {
      curLat += dLat + (Math.sin(s) * 0.0005)
      curLng += dLng + (Math.cos(s) * 0.0005)
      curMinute += 2 + Math.floor(Math.random() * 2)
      const currentSpeed = 25 + Math.floor(Math.random() * 32)
      if (currentSpeed > maxSpeed) maxSpeed = currentSpeed

      // Cálculo de distancia euclidiana simplificada para la simulación
      const stepDist = Math.sqrt(dLat * dLat + dLng * dLng) * 111
      totalDist += stepDist

      const heading = Math.round((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360

      points.push({
        lat: curLat,
        lng: curLng,
        speed_kmh: currentSpeed,
        heading,
        timestamp: new Date(`${baseDate}T${String(Math.floor(curMinute / 60)).padStart(2, '0')}:${String(curMinute % 60).padStart(2, '0')}:00`).toISOString(),
        accuracy_m: 6,
      })
    }

    curLat = wp.lat
    curLng = wp.lng

    // Si tiene parada
    if (wp.stopMin && wp.stopMin > 0) {
      const arrTime = new Date(`${baseDate}T${String(Math.floor(curMinute / 60)).padStart(2, '0')}:${String(curMinute % 60).padStart(2, '0')}:00`).toISOString()
      curMinute += wp.stopMin
      const depTime = new Date(`${baseDate}T${String(Math.floor(curMinute / 60)).padStart(2, '0')}:${String(curMinute % 60).padStart(2, '0')}:00`).toISOString()

      stops.push({
        id: `stop-${wIdx}-${Math.random()}`,
        lat: wp.lat,
        lng: wp.lng,
        location_name: wp.label,
        arrival_time: arrTime,
        departure_time: depTime,
        duration_min: wp.stopMin,
        kind: wp.stopMin > 35 ? 'pausa_almuerzo' : 'entrega',
        notes: `Parada registrada en ${wp.label} (${wp.stopMin} minutos)`,
      })
    }
  })

  const distanceKm = Math.round(totalDist * 10) / 10
  const avgSpeed = Math.round(points.reduce((acc, p) => acc + p.speed_kmh, 0) / points.length)

  return { points, stops, distanceKm, avgSpeed, maxSpeed }
}

const todayStr = new Date().toISOString().split('T')[0]
const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0]
const threeDaysAgoStr = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0]

// Semilla de historiales de rutas recorridas
const DEFAULT_ROUTE_HISTORIES: VehicleRouteHistory[] = [
  // 1. Ruta de HOY - Camión WDF-892 (Ruta en curso)
  (() => {
    const data = generateMockRoutePoints(
      4.678,
      -74.125,
      [
        { lat: 4.662, lng: -74.112, label: 'Distribuidora Panamericana', stopMin: 22 },
        { lat: 4.645, lng: -74.095, label: 'Supermercado Central Calle 26', stopMin: 35 },
        { lat: 4.628, lng: -74.088, label: 'Almacén Piso de Venta Centro', stopMin: 25 },
        { lat: 4.615, lng: -74.075, label: 'Bodega de Reparto Cra 10', stopMin: 0 },
      ],
      todayStr,
      7
    )
    return {
      id: 'hist-today-wdf',
      vehicle_id: 'veh-1',
      vehicle_plate: 'WDF-892',
      vehicle_name: 'Camión Chevrolet NPR Turbo 4.5T',
      driver_name: 'Carlos Alberto Mendoza',
      date: todayStr,
      start_time: `${todayStr}T07:15:00.000Z`,
      status: 'en_curso',
      total_distance_km: data.distanceKm,
      avg_speed_kmh: data.avgSpeed,
      max_speed_kmh: data.maxSpeed,
      moving_time_min: 68,
      stopped_time_min: 82,
      origin_name: 'Bodega Principal Mayorista (Zona Occidente)',
      destination_name: 'Almacén Piso de Venta Centro',
      points: data.points,
      stops: data.stops,
    }
  })(),

  // 2. Ruta de AYER - Furgón TLK-431 (Cadena de Frío - Completada)
  (() => {
    const data = generateMockRoutePoints(
      4.678,
      -74.125,
      [
        { lat: 4.685, lng: -74.098, label: 'Frigorífico El Rodeo', stopMin: 28 },
        { lat: 4.712, lng: -74.065, label: 'Supertienda Calle 134', stopMin: 24 },
        { lat: 4.745, lng: -74.043, label: 'Bodega Despacho Ruta Norte', stopMin: 40 },
        { lat: 4.725, lng: -74.055, label: 'Lácteos Sabana Norte', stopMin: 20 },
        { lat: 4.678, lng: -74.125, label: 'Retorno a Bodega Principal', stopMin: 15 },
      ],
      yesterdayStr,
      6
    )
    return {
      id: 'hist-yesterday-tlk',
      vehicle_id: 'veh-2',
      vehicle_plate: 'TLK-431',
      vehicle_name: 'Furgón NHR Refrigerado Cadena Frío',
      driver_name: 'Mauricio Gómez Peña',
      date: yesterdayStr,
      start_time: `${yesterdayStr}T06:30:00.000Z`,
      end_time: `${yesterdayStr}T13:45:00.000Z`,
      status: 'completada',
      total_distance_km: 34.6,
      avg_speed_kmh: 28,
      max_speed_kmh: 58,
      moving_time_min: 94,
      stopped_time_min: 127,
      origin_name: 'Bodega Principal Mayorista',
      destination_name: 'Ruta Norte y Retorno Central',
      points: data.points,
      stops: data.stops,
    }
  })(),

  // 3. Ruta Hace 3 Días - Camioneta JHY-628 (Entregas Express Norte)
  (() => {
    const data = generateMockRoutePoints(
      4.745,
      -74.043,
      [
        { lat: 4.762, lng: -74.032, label: 'Droguería y Minimarket Chía', stopMin: 18 },
        { lat: 4.785, lng: -74.025, label: 'Restaurante Campestre El Portal', stopMin: 22 },
        { lat: 4.745, lng: -74.043, label: 'Retorno Base Muelle Norte', stopMin: 10 },
      ],
      threeDaysAgoStr,
      8
    )
    return {
      id: 'hist-threedays-jhy',
      vehicle_id: 'veh-3',
      vehicle_plate: 'JHY-628',
      vehicle_name: 'Camioneta Reparto Rápido D-Max',
      driver_name: 'Hernando Silva',
      date: threeDaysAgoStr,
      start_time: `${threeDaysAgoStr}T08:00:00.000Z`,
      end_time: `${threeDaysAgoStr}T12:15:00.000Z`,
      status: 'completada',
      total_distance_km: 21.2,
      avg_speed_kmh: 34,
      max_speed_kmh: 62,
      moving_time_min: 48,
      stopped_time_min: 50,
      origin_name: 'Bodega Despacho Ruta Norte',
      destination_name: 'Circuito Express Sabana',
      points: data.points,
      stops: data.stops,
    }
  })(),
]

export function getRouteHistories(vehicleId?: string, date?: string): VehicleRouteHistory[] {
  try {
    const raw = localStorage.getItem(HISTORIES_STORAGE_KEY)
    let list: VehicleRouteHistory[] = raw ? JSON.parse(raw) : DEFAULT_ROUTE_HISTORIES
    if (!raw) {
      localStorage.setItem(HISTORIES_STORAGE_KEY, JSON.stringify(DEFAULT_ROUTE_HISTORIES))
    }
    if (vehicleId && vehicleId !== 'all') {
      list = list.filter(h => h.vehicle_id === vehicleId)
    }
    if (date) {
      list = list.filter(h => h.date === date)
    }
    return list
  } catch {
    return DEFAULT_ROUTE_HISTORIES
  }
}

export function saveRouteHistory(history: VehicleRouteHistory): VehicleRouteHistory[] {
  const list = getRouteHistories()
  const exists = list.some(h => h.id === history.id)
  const updated = exists ? list.map(h => (h.id === history.id ? history : h)) : [history, ...list]
  try {
    localStorage.setItem(HISTORIES_STORAGE_KEY, JSON.stringify(updated))
  } catch (e) {
    console.error('Error saving route history:', e)
  }
  return updated
}

export function getRouteHistoryById(id: string): VehicleRouteHistory | null {
  const list = getRouteHistories()
  return list.find(h => h.id === id) || null
}

// ============================================================================
// SERVICIO DE GEOLOCALIZACIÓN Y TELEMETRÍA EN TIEMPO REAL
// ============================================================================

export interface LiveVehicleTelemetry {
  vehicle: FleetVehicle
  is_online: boolean
  last_ping: string
  current_lat: number
  current_lng: number
  speed_kmh: number
  heading_deg: number
  accuracy_m: number
  battery_pct: number
  signal_status: 'excelente' | 'buena' | 'debil' | 'sin_conexion'
}

let activeWatchId: number | null = null

/**
 * Inicia el monitoreo continuo con la API nativa de geolocalización de HTML5
 * para transmitir la posición real del vehículo/despachador.
 */
export function startNativeDeviceTracking(
  vehicleId: string,
  onPositionUpdate: (coords: { lat: number; lng: number; speed: number; heading: number; accuracy: number }) => void,
  onError?: (err: GeolocationPositionError) => void
): boolean {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return false
  }

  if (activeWatchId !== null) {
    navigator.geolocation.clearWatch(activeWatchId)
    activeWatchId = null
  }

  activeWatchId = navigator.geolocation.watchPosition(
    pos => {
      const { latitude, longitude, speed, heading, accuracy } = pos.coords
      const speedKmh = speed != null ? Math.round(speed * 3.6) : 0
      const headingDeg = heading != null ? Math.round(heading) : 0

      // Persistir en el vehículo de flota
      const vehicles = getFleetVehicles()
      const target = vehicles.find(v => v.id === vehicleId)
      if (target) {
        saveFleetVehicle({
          ...target,
          current_lat: latitude,
          current_lng: longitude,
          last_gps_at: new Date().toISOString(),
          is_gps_active: true,
          status: 'en_ruta',
        })
      }

      onPositionUpdate({
        lat: latitude,
        lng: longitude,
        speed: speedKmh,
        heading: headingDeg,
        accuracy: Math.round(accuracy),
      })
    },
    err => {
      console.warn('Geolocation watch error:', err)
      onError?.(err)
    },
    {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 12000,
    }
  )

  return true
}

export function stopNativeDeviceTracking(): void {
  if (activeWatchId !== null && typeof navigator !== 'undefined') {
    navigator.geolocation.clearWatch(activeWatchId)
    activeWatchId = null
  }
}

/**
 * Obtiene la telemetría actual de todos los vehículos de la flota
 */
export function getFleetLiveTelemetry(): LiveVehicleTelemetry[] {
  const vehicles = getFleetVehicles()

  return vehicles.map(v => {
    const isOnline = Boolean(v.is_gps_active || v.status === 'en_ruta')
    const lastPing = v.last_gps_at || new Date().toISOString()
    const whCoords = getWarehouseCoords(v.warehouse_id)
    const lat = v.current_lat ?? whCoords.lat
    const lng = v.current_lng ?? whCoords.lng

    // Simulación de variación de velocidad si está en ruta
    const speed = v.status === 'en_ruta' ? 38 : 0
    const heading = v.status === 'en_ruta' ? 142 : 0

    return {
      vehicle: v,
      is_online: isOnline,
      last_ping: lastPing,
      current_lat: lat,
      current_lng: lng,
      speed_kmh: speed,
      heading_deg: heading,
      accuracy_m: 8,
      battery_pct: 88,
      signal_status: isOnline ? 'excelente' : 'sin_conexion',
    }
  })
}
