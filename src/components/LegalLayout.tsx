import DeveloperCredit from './DeveloperCredit'

export interface LegalSection {
  title: string
  paragraphs: string[]
}

export default function LegalLayout({ title, updated, intro, sections }: {
  title: string
  updated: string
  intro: string
  sections: LegalSection[]
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <a href="/" className="text-sm text-slate-500 hover:text-slate-700">← Volver a InventarioPro</a>
        <h1 className="text-2xl font-bold text-slate-800 mt-4">{title}</h1>
        <p className="text-xs text-slate-400 mt-1">Última actualización: {updated}</p>
        <p className="text-sm text-slate-600 leading-relaxed mt-4">{intro}</p>

        <div className="mt-6 space-y-6">
          {sections.map((s, i) => (
            <section key={i}>
              <h2 className="text-base font-semibold text-slate-800 mb-2">{i + 1}. {s.title}</h2>
              {s.paragraphs.map((p, j) => (
                <p key={j} className="text-sm text-slate-600 leading-relaxed mb-2">{p}</p>
              ))}
            </section>
          ))}
        </div>

        <div className="mt-10 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <DeveloperCredit />
          <nav className="flex gap-4 text-xs text-slate-500">
            <a href="/terminos" className="hover:underline">Términos y condiciones</a>
            <a href="/privacidad" className="hover:underline">Política de privacidad</a>
          </nav>
        </div>
      </div>
    </div>
  )
}
