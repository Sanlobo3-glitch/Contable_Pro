import type { Product } from '../types'

/* Precio de un producto según el tipo de cliente y la cantidad.
   Se cobra el precio POR MAYOR cuando el producto lo tiene y se cumple alguna de estas dos:
   - el cliente (o la venta) es de tipo «mayor»
   - la cantidad llega a «Por mayor desde» (definida por el dueño en el producto)
   Si no, se cobra el precio detal. */

export type PriceType = 'detal' | 'mayor'

type PriceFields = Pick<Product, 'price' | 'price_wholesale' | 'wholesale_min_qty'>

export function priceFor(p: PriceFields, qty: number, type: PriceType): { price: number; mayor: boolean } {
  const retail = Number(p.price) || 0
  const wholesale = Number(p.price_wholesale) || 0
  if (wholesale > 0) {
    const min = Number(p.wholesale_min_qty) || 0
    if (type === 'mayor' || (min > 0 && qty >= min)) return { price: wholesale, mayor: true }
  }
  return { price: retail, mayor: false }
}
