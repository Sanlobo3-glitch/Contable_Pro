export const DEVELOPER_NAME = 'Richard J. Lobo S.'

export default function DeveloperCredit({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs text-slate-400 ${className}`}>
      InventarioPro · Desarrollado por{' '}
      <span className="font-medium text-slate-500">{DEVELOPER_NAME}</span>
    </p>
  )
}
