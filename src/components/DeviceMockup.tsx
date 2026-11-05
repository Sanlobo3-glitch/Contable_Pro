export type DeviceKind = 'movil' | 'tablet' | 'pc' | 'mac'

function Screen({ portrait = false }: { portrait?: boolean }) {
  if (portrait) {
    return (
      <svg viewBox="0 0 62 132" preserveAspectRatio="xMidYMid slice">
        <rect width="62" height="132" fill="#f8fafc" />
        <rect width="62" height="24" fill="#1e293b" />
        <rect x="8" y="9" width="26" height="6" rx="3" fill="#94a3b8" />
        {[0, 1, 2].map(i => <rect key={i} x="6" y={32 + i * 26} width="50" height="20" rx="4" fill="#fff" stroke="#e2e8f0" />)}
        {[0, 1, 2].map(i => <rect key={'a' + i} x="11" y={38 + i * 26} width="18" height="4" rx="2" fill="#10b981" />)}
        <rect x="6" y="112" width="50" height="14" rx="4" fill="#1e293b" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice">
      <rect width="160" height="100" fill="#f8fafc" />
      <rect width="34" height="100" fill="#1e293b" />
      <rect x="8" y="10" width="18" height="6" rx="3" fill="#64748b" />
      {[0, 1, 2, 3].map(i => <rect key={i} x="7" y={26 + i * 10} width="20" height="5" rx="2.5" fill={i === 0 ? '#fff' : '#475569'} />)}
      <rect x="42" y="10" width="60" height="7" rx="3" fill="#cbd5e1" />
      {[0, 1, 2].map(i => <rect key={i} x={42 + i * 38} y="26" width="34" height="20" rx="4" fill="#fff" stroke="#e2e8f0" />)}
      {[0, 1, 2].map(i => <rect key={'k' + i} x={46 + i * 38} y="32" width="14" height="4" rx="2" fill="#94a3b8" />)}
      {[0, 1, 2].map(i => <rect key={'v' + i} x={46 + i * 38} y="39" width="22" height="4" rx="2" fill="#10b981" />)}
      <rect x="42" y="54" width="112" height="38" rx="4" fill="#fff" stroke="#e2e8f0" />
      {[10, 22, 16, 30, 24, 34, 20].map((h, i) => <rect key={i} x={50 + i * 14} y={88 - h} width="8" height={h} rx="2" fill="#334155" />)}
    </svg>
  )
}

export default function DeviceMockup({ kind, className = '' }: { kind: DeviceKind; className?: string }) {
  const cls = `w-full h-auto ${className}`
  if (kind === 'movil') {
    return (
      <svg viewBox="0 0 70 140" className={cls}>
        <rect width="70" height="140" rx="13" fill="#0f172a" />
        <svg x="4" y="4" width="62" height="132"><Screen portrait /></svg>
        <rect x="26" y="7" width="18" height="4" rx="2" fill="#0f172a" />
      </svg>
    )
  }
  if (kind === 'tablet') {
    return (
      <svg viewBox="0 0 160 115" className={cls}>
        <rect width="160" height="115" rx="10" fill="#0f172a" />
        <svg x="7" y="7" width="146" height="101"><Screen /></svg>
      </svg>
    )
  }
  if (kind === 'mac') {
    return (
      <svg viewBox="0 0 200 130" className={cls}>
        <rect x="22" y="2" width="156" height="104" rx="7" fill="#0f172a" />
        <svg x="27" y="7" width="146" height="94"><Screen /></svg>
        <path d="M2 108h196l-8 14a6 6 0 0 1-5 3H15a6 6 0 0 1-5-3z" fill="#cbd5e1" />
        <rect x="82" y="108" width="36" height="4" rx="2" fill="#94a3b8" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 200 150" className={cls}>
      <rect x="10" y="2" width="180" height="112" rx="7" fill="#0f172a" />
      <svg x="16" y="8" width="168" height="100"><Screen /></svg>
      <rect x="90" y="114" width="20" height="22" fill="#94a3b8" />
      <rect x="62" y="136" width="76" height="8" rx="4" fill="#cbd5e1" />
    </svg>
  )
}
  
