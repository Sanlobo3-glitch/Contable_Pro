/* Traduce errores técnicos (Supabase / Postgres / red) a mensajes claros en español.
   Los mensajes que el servidor ya escribe en español (stock insuficiente, cliente no existe…) NO se tocan.
   El texto técnico original se deja en la consola para poder diagnosticar. */

const RULES: Array<[RegExp, string]> = [
  [/permission denied|row-level security|violates row-level/i,
    'No tienes permiso para hacer esto, o falta configurar permisos en el servidor. Avísale al administrador.'],
  [/could not choose the best candidate function|could not find the function|schema cache/i,
    'La app y el servidor no están en la misma versión. Cierra la app, ábrela de nuevo y vuelve a intentar. Si sigue, avísale al administrador.'],
  [/jwt expired|invalid jwt|not authenticated|invalid refresh token/i,
    'Tu sesión venció. Cierra sesión y vuelve a entrar.'],
  [/failed to fetch|networkerror|network request failed|load failed/i,
    'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'],
  [/statement timeout|canceling statement/i,
    'El servidor tardó demasiado en responder. Inténtalo de nuevo.'],
  [/duplicate key value violates unique constraint/i,
    'Ese registro ya existe.'],
  [/violates foreign key constraint/i,
    'No se puede completar porque ese registro está ligado a otros datos.'],
  [/violates not-null constraint|null value in column/i,
    'Falta un dato obligatorio.'],
  [/violates check constraint/i,
    'Algún dato no es válido. Revísalo e inténtalo de nuevo.'],
]

/** Devuelve el mensaje en español claro; si no reconoce el error, lo deja igual. */
export function friendlyMessage(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw ?? '')
  for (const [re, msg] of RULES) {
    const m = re.exec(text)
    if (m) {
      // Conserva el encabezado de la app: "Error al registrar la venta: …"
      const head = text.slice(0, m.index).replace(/[\s:]+$/, '')
      return head ? `${head}: ${msg}` : msg
    }
  }
  return text
}

function showToast(message: string) {
  if (typeof document === 'undefined' || !document.body) return
  let host = document.getElementById('ip-toast-host')
  if (!host) {
    host = document.createElement('div')
    host.id = 'ip-toast-host'
    host.className = 'fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none'
    document.body.appendChild(host)
  }
  const item = document.createElement('div')
  item.className = 'pointer-events-auto bg-slate-900 text-white text-xs sm:text-sm px-4 py-3 rounded-xl shadow-lg border border-slate-700 leading-snug'
  item.textContent = message
  host.appendChild(item)
  window.setTimeout(() => {
    item.remove()
  }, 4500)
}

/** Hace que todos los alert() de la app muestren el mensaje claro (el original queda en la consola). */
export function installFriendlyAlerts() {
  if (typeof window === 'undefined') return
  const original = window.alert.bind(window)
  let inIframe = false
  try { inIframe = window.self !== window.top } catch { inIframe = true }
  window.alert = (message?: unknown) => {
    const text = String(message ?? '')
    const friendly = friendlyMessage(text)
    if (friendly !== text) console.warn('[error original]', text)
    if (inIframe) showToast(friendly)
    else original(friendly)
  }
}
