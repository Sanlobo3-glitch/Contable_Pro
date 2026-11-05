import { AlertTriangle } from 'lucide-react'

export default function ReadOnlyBanner({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 text-amber-800">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>Tu periodo de prueba terminó. Estás en modo de solo lectura.</span>
      </div>
      <button onClick={onUpgrade} className="shrink-0 bg-amber-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-amber-700">
        Ver planes
      </button>
    </div>
  )
}
