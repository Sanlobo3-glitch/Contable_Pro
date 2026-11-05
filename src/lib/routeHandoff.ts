export interface RouteCustomerHandoff {
  customerId: string
  customerName: string
  action: 'sale' | 'visit'
  stopId?: string
  ts: number
}

const KEY = 'ip_route_customer_handoff_v1'

export function setRouteCustomerHandoff(payload: Omit<RouteCustomerHandoff, 'ts'>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...payload, ts: Date.now() }))
  } catch {
    // Ignorar si sessionStorage está restringido
  }
}

export function consumeRouteCustomerHandoff(): RouteCustomerHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    sessionStorage.removeItem(KEY)
    const parsed = JSON.parse(raw) as RouteCustomerHandoff
    if (!parsed?.customerId || Date.now() - (parsed.ts || 0) > 5 * 60 * 1000) return null
    return parsed
  } catch {
    return null
  }
}
