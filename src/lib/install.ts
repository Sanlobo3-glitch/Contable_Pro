import { useEffect, useState } from 'react'

// Guarda el aviso de instalación del navegador para ofrecerlo con un botón propio.
let deferred: any = null
const listeners = new Set<() => void>()
function notify() { listeners.forEach(f => f()) }

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => { e.preventDefault(); deferred = e; notify() })
  window.addEventListener('appinstalled', () => { deferred = null; notify() })
}

function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
  } catch { return false }
}

export function useInstall() {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force(n => n + 1)
    listeners.add(f)
    return () => { listeners.delete(f) }
  }, [])
  async function install() {
    if (!deferred) return
    deferred.prompt()
    try { await deferred.userChoice } catch { /* cancelado */ }
    deferred = null
    notify()
  }
  return { canInstall: !!deferred && !isStandalone(), install }
}
