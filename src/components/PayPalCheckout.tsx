import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID || ''

declare global {
  interface Window {
    paypal?: any
  }
}

export default function PayPalCheckout({ amount, currency, onSuccess, onError }: {
  amount: number
  currency: string
  onSuccess: (orderId: string) => void
  onError: (err: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!PAYPAL_CLIENT_ID) {
      setError('PayPal no configurado. Contacte al administrador.')
      return
    }

    const existing = document.querySelector(`script[src*="paypal.com/sdk"]`)
    if (existing) {
      if (window.paypal) setLoaded(true)
      else existing.addEventListener('load', () => setLoaded(true))
      return
    }

    const script = document.createElement('script')
    script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=${currency}`
    script.async = true
    script.onload = () => setLoaded(true)
    script.onerror = () => setError('Error cargando PayPal SDK')
    document.body.appendChild(script)
  }, [currency])

  useEffect(() => {
    if (!loaded || !window.paypal || !containerRef.current) return
    if (containerRef.current.children.length > 0) return

    window.paypal.Buttons({
      createOrder: (_data: any, actions: any) => {
        return actions.order.create({
          purchase_units: [{
            amount: { value: amount.toFixed(2), currency_code: currency },
            description: 'Suscripción InventarioPro - 30 días',
          }],
        })
      },
      onApprove: async (_data: any, actions: any) => {
        try {
          const details = await actions.order.capture()
          onSuccess(details.id)
        } catch (err: any) {
          onError(err.message || 'Error al procesar el pago')
        }
      },
      onError: (err: any) => {
        onError(err.message || 'Error en PayPal')
      },
    }).render(containerRef.current)
  }, [loaded, amount, currency, onSuccess, onError])

  if (error) return <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
  if (!loaded) return <p className="text-sm text-slate-400 text-center py-4">Cargando PayPal...</p>

  return <div ref={containerRef} />
}
