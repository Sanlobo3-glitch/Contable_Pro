import { useEffect, useRef, useState } from 'react'
import { loadLeaflet } from '../../lib/leaflet'
import { getWarehouseCoords, updateTransferGpsPosition } from '../../lib/fleetRepo'
import type { InventoryTransfer, Warehouse } from '../../types'
import {
  X,
  Navigation,
  Truck,
  MapPin,
  Clock,
  Phone,
  Radio,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react'

interface TransferRouteMapModalProps {
  transfer: InventoryTransfer
  sourceWarehouse?: Warehouse
  destWarehouse?: Warehouse
  onClose: () => void
  onGpsUpdated?: () => void
}

export default function TransferRouteMapModal({
  transfer,
  sourceWarehouse,
  destWarehouse,
  onClose,
  onGpsUpdated,
}: TransferRouteMapModalProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markerVehicleRef = useRef<any>(null)
  const routeLineRef = useRef<any>(null)

  const [isLiveGpsActive, setIsLiveGpsActive] = useState(Boolean(transfer.live_tracking_active))
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [simulating, setSimulating] = useState(false)
  const [simProgress, setSimProgress] = useState(0.4) // 40% del camino por defecto
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number }>({
    lat: transfer.last_lat ?? getWarehouseCoords(transfer.source_warehouse_id).lat,
    lng: transfer.last_lng ?? getWarehouseCoords(transfer.source_warehouse_id).lng,
  })

  const srcCoords = getWarehouseCoords(transfer.source_warehouse_id)
  const dstCoords = getWarehouseCoords(transfer.destination_warehouse_id)

  // Cálculo de distancia en línea recta / ruta aproximada (Haversine)
  const distanceKm = (() => {
    const R = 6371
    const dLat = ((dstCoords.lat - srcCoords.lat) * Math.PI) / 180
    const dLon = ((dstCoords.lng - srcCoords.lng) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((srcCoords.lat * Math.PI) / 180) *
        Math.cos((dstCoords.lat * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    const raw = R * c
    return Math.round(raw * 1.35 * 10) / 10 // Factor de curvatura urbana
  })()

  const estTimeMin = Math.round(distanceKm * 2.5) // ~24 km/h en tráfico urbano

  // Inicializar Leaflet
  useEffect(() => {
    let isCancelled = false

    loadLeaflet().then(L => {
      if (isCancelled || !mapContainerRef.current) return

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }

      const map = L.map(mapContainerRef.current).setView(
        [(srcCoords.lat + dstCoords.lat) / 2, (srcCoords.lng + dstCoords.lng) / 2],
        13
      )
      mapInstanceRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map)

      // Iconos personalizados con HTML estilizado de Tailwind
      const createIcon = (bgClass: string, label: string, isTruck = false) => {
        return L.divIcon({
          className: 'custom-leaflet-marker',
          html: `
            <div class="relative flex items-center justify-center">
              <div class="w-10 h-10 ${bgClass} rounded-full border-2 border-white shadow-xl flex items-center justify-center text-white font-bold text-xs">
                ${isTruck ? '🚚' : '🏢'}
              </div>
              <div class="absolute -bottom-6 px-2 py-0.5 bg-slate-900/90 text-white rounded text-[10px] font-semibold whitespace-nowrap shadow">
                ${label}
              </div>
            </div>
          `,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        })
      }

      // Marcador Bodega Origen
      L.marker([srcCoords.lat, srcCoords.lng], {
        icon: createIcon('bg-blue-600', sourceWarehouse?.name || 'Origen'),
      })
        .addTo(map)
        .bindPopup(`<b>Origen:</b> ${sourceWarehouse?.name || 'Bodega Origen'}<br/>${sourceWarehouse?.address || ''}`)

      // Marcador Bodega Destino
      L.marker([dstCoords.lat, dstCoords.lng], {
        icon: createIcon('bg-emerald-600', destWarehouse?.name || 'Destino'),
      })
        .addTo(map)
        .bindPopup(`<b>Destino:</b> ${destWarehouse?.name || 'Bodega Destino'}<br/>${destWarehouse?.address || ''}`)

      // Puntos intermedios para simular trazado de vía principal
      const midLat1 = srcCoords.lat + (dstCoords.lat - srcCoords.lat) * 0.35 + 0.003
      const midLng1 = srcCoords.lng + (dstCoords.lng - srcCoords.lng) * 0.35 - 0.002
      const midLat2 = srcCoords.lat + (dstCoords.lat - srcCoords.lat) * 0.7 - 0.002
      const midLng2 = srcCoords.lng + (dstCoords.lng - srcCoords.lng) * 0.7 + 0.003

      const routePoints: [number, number][] = [
        [srcCoords.lat, srcCoords.lng],
        [midLat1, midLng1],
        [midLat2, midLng2],
        [dstCoords.lat, dstCoords.lng],
      ]

      // Dibujar línea de ruta
      const polyline = L.polyline(routePoints, {
        color: '#2563eb',
        weight: 5,
        opacity: 0.85,
        dashArray: '8, 8',
      }).addTo(map)
      routeLineRef.current = polyline

      // Marcador de Vehículo / Conductor en ruta
      const initialVehicleLat = currentCoords.lat || (srcCoords.lat + (dstCoords.lat - srcCoords.lat) * 0.4)
      const initialVehicleLng = currentCoords.lng || (srcCoords.lng + (dstCoords.lng - srcCoords.lng) * 0.4)

      const vehicleMarker = L.marker([initialVehicleLat, initialVehicleLng], {
        icon: createIcon('bg-amber-500 animate-pulse', transfer.vehicle_plate || 'Vehículo', true),
        zIndexOffset: 1000,
      }).addTo(map)

      vehicleMarker.bindPopup(`
        <div style="font-size:12px; line-height:1.4;">
          <b>${transfer.vehicle_name || 'Vehículo de Transporte'}</b><br/>
          <b>Placa:</b> ${transfer.vehicle_plate || 'N/A'}<br/>
          <b>Conductor:</b> ${transfer.driver_name || 'No asignado'}<br/>
          <b>Estado:</b> En tránsito activo
        </div>
      `)
      markerVehicleRef.current = vehicleMarker

      // Ajustar encuadre para que se vean todos los puntos
      map.fitBounds(polyline.getBounds(), { padding: [40, 40] })
    })

    return () => {
      isCancelled = true
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [srcCoords.lat, srcCoords.lng, dstCoords.lat, dstCoords.lng, transfer.id])

  // Geolocalización del navegador en tiempo real para el despachador/conductor
  useEffect(() => {
    if (!isLiveGpsActive) return

    if (!navigator.geolocation) {
      setGpsError('La geolocalización no está soportada en este navegador.')
      setIsLiveGpsActive(false)
      return
    }

    const watchId = navigator.geolocation.watchPosition(
      pos => {
        const { latitude, longitude } = pos.coords
        setCurrentCoords({ lat: latitude, lng: longitude })
        updateTransferGpsPosition(transfer.id, latitude, longitude, transfer.vehicle_id)
        if (markerVehicleRef.current) {
          markerVehicleRef.current.setLatLng([latitude, longitude])
        }
        onGpsUpdated?.()
        setGpsError(null)
      },
      err => {
        console.warn('GPS watch error:', err)
        setGpsError('No se pudo obtener señal GPS del dispositivo (' + err.message + ').')
        setIsLiveGpsActive(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [isLiveGpsActive, transfer.id, transfer.vehicle_id, onGpsUpdated])

  // Simulación interactiva de avance del camión en ruta
  useEffect(() => {
    if (!simulating) return

    const interval = setInterval(() => {
      setSimProgress(prev => {
        const next = prev >= 0.95 ? 0.1 : prev + 0.05
        const currentLat = srcCoords.lat + (dstCoords.lat - srcCoords.lat) * next
        const currentLng = srcCoords.lng + (dstCoords.lng - srcCoords.lng) * next
        setCurrentCoords({ lat: currentLat, lng: currentLng })
        updateTransferGpsPosition(transfer.id, currentLat, currentLng, transfer.vehicle_id)

        if (markerVehicleRef.current) {
          markerVehicleRef.current.setLatLng([currentLat, currentLng])
        }
        onGpsUpdated?.()
        return next
      })
    }, 1200)

    return () => clearInterval(interval)
  }, [simulating, srcCoords, dstCoords, transfer.id, transfer.vehicle_id, onGpsUpdated])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Cabecera */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
              <Navigation className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">
                  Ruta y Telemetría GPS en Vivo · #{transfer.id.slice(0, 8).toUpperCase()}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {transfer.status === 'in_transit' ? 'En Tránsito' : transfer.status}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {sourceWarehouse?.name || 'Origen'} → {destWarehouse?.name || 'Destino'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido dividido: Mapa + Panel de Control */}
        <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-[460px] overflow-hidden">
          {/* Contenedor del Mapa Leaflet */}
          <div className="lg:col-span-8 relative bg-slate-100 min-h-[350px] lg:min-h-full">
            <div ref={mapContainerRef} className="absolute inset-0 w-full h-full z-10" />

            {/* Overlay flotante de métricas rápidas */}
            <div className="absolute top-4 left-4 z-20 bg-white/95 backdrop-blur shadow-md rounded-xl p-3 border border-slate-200 text-xs flex items-center gap-4">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-600" />
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">Distancia</p>
                  <p className="font-bold text-slate-900">{distanceKm} km</p>
                </div>
              </div>
              <div className="h-6 w-px bg-slate-200" />
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600" />
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">Tiempo Est.</p>
                  <p className="font-bold text-slate-900">~{estTimeMin} min</p>
                </div>
              </div>
              <div className="h-6 w-px bg-slate-200" />
              <div className="flex items-center gap-2">
                <Radio className={`w-4 h-4 ${isLiveGpsActive ? 'text-emerald-500 animate-pulse' : 'text-slate-400'}`} />
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">Señal GPS</p>
                  <p className="font-bold text-slate-900">{isLiveGpsActive ? 'Activa' : 'Última señal'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Panel Lateral: Información del Vehículo, Conductor y Telemetría */}
          <div className="lg:col-span-4 bg-slate-50 p-5 border-t lg:border-t-0 lg:border-l border-slate-200 flex flex-col justify-between overflow-y-auto max-h-[500px] lg:max-h-none">
            <div className="space-y-4">
              {/* Tarjeta del Vehículo de Flota */}
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-slate-700" />
                    <span className="text-xs font-bold text-slate-900 uppercase">Vehículo Asignado</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-slate-900 text-white">
                    {transfer.vehicle_plate || 'SIN PLACA'}
                  </span>
                </div>

                <div className="text-xs space-y-1 text-slate-600">
                  <p className="font-semibold text-slate-800">{transfer.vehicle_name || 'Camión de Carga General'}</p>
                  <p className="text-[11px] text-slate-500">
                    Bodega Base:{' '}
                    <span className="font-medium text-slate-700">
                      {sourceWarehouse?.name || 'Sede Central'}
                    </span>
                  </p>
                </div>
              </div>

              {/* Tarjeta Conductor y Despachador */}
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 uppercase">Tripulación de Ruta</span>
                  <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-semibold border border-emerald-200">
                    En Servicio
                  </span>
                </div>

                <div className="text-xs space-y-2">
                  <div>
                    <p className="text-[11px] text-slate-400">Conductor Titular:</p>
                    <p className="font-bold text-slate-900">{transfer.driver_name || 'Carlos Alberto Mendoza'}</p>
                    <div className="flex items-center gap-2 text-slate-500 text-[11px] mt-0.5">
                      <Phone className="w-3 h-3 text-slate-400" />
                      <span>{transfer.driver_phone || '+57 312 849 2011'}</span>
                      {transfer.driver_license && (
                        <span className="text-slate-400">· Lic: {transfer.driver_license}</span>
                      )}
                    </div>
                  </div>

                  {transfer.dispatcher_name && (
                    <div className="pt-2 border-t border-slate-100">
                      <p className="text-[11px] text-slate-400">Despachador / Auxiliar:</p>
                      <p className="font-semibold text-slate-800">{transfer.dispatcher_name}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Coordenadas en tiempo real */}
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm space-y-2 text-xs">
                <p className="font-bold text-slate-900 flex items-center justify-between">
                  <span>Telemetría de Posición</span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    {transfer.last_gps_updated_at
                      ? new Date(transfer.last_gps_updated_at).toLocaleTimeString()
                      : 'Ahora'}
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-600 bg-slate-50 p-2 rounded-lg">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Latitud</span>
                    {currentCoords.lat.toFixed(5)}
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Longitud</span>
                    {currentCoords.lng.toFixed(5)}
                  </div>
                </div>

                {gpsError && (
                  <p className="text-[11px] text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {gpsError}
                  </p>
                )}
              </div>
            </div>

            {/* Acciones de Control de GPS y Simulación */}
            <div className="pt-4 space-y-2">
              <button
                type="button"
                onClick={() => setIsLiveGpsActive(prev => !prev)}
                className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                  isLiveGpsActive
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20'
                    : 'bg-slate-900 hover:bg-slate-800 text-white'
                }`}
              >
                <Radio className={`w-4 h-4 ${isLiveGpsActive ? 'animate-pulse' : ''}`} />
                {isLiveGpsActive ? 'Transmitiendo GPS en Vivo (Activo)' : 'Transmitir Mi GPS en Vivo (Conductor)'}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSimulating(prev => !prev)}
                  className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                    simulating
                      ? 'border-amber-400 bg-amber-50 text-amber-800'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Play className="w-3.5 h-3.5" />
                  {simulating ? 'Pausar Simulación' : 'Simular Avance'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSimulating(false)
                    setSimProgress(0.1)
                    setCurrentCoords({ lat: srcCoords.lat, lng: srcCoords.lng })
                    if (markerVehicleRef.current) {
                      markerVehicleRef.current.setLatLng([srcCoords.lat, srcCoords.lng])
                    }
                  }}
                  className="py-2 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reiniciar
                </button>
              </div>

              <a
                href={`https://www.google.com/maps/dir/?api=1&origin=${srcCoords.lat},${srcCoords.lng}&destination=${dstCoords.lat},${dstCoords.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2 px-3 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Abrir navegación en Google Maps / Waze
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
