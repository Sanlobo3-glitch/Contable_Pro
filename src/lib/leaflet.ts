// Carga de Leaflet (OpenStreetMap) bajo demanda, sin instalar nada. Se comparte con otras pantallas.
const LEAFLET_VERSION = '1.9.4'
let leafletPromise: Promise<any> | null = null

export function loadLeaflet(): Promise<any> {
  const w = window as any
  if (w.L) return Promise.resolve(w.L)
  if (leafletPromise) return leafletPromise
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`
    document.head.appendChild(css)
    const s = document.createElement('script')
    s.src = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`
    s.onload = () => resolve((window as any).L)
    s.onerror = () => { leafletPromise = null; reject(new Error('No se pudo cargar el mapa. Revisa tu conexión.')) }
    document.head.appendChild(s)
  })
  return leafletPromise
}
