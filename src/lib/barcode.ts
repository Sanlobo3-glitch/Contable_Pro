/* Generador de códigos sin librerías externas.
   - qrSvg(texto): código QR (nivel de corrección M, hasta ~210 caracteres)
   - code128Svg(texto): código de barras Code 128 (caracteres ASCII 32 a 126)
   Los dos devuelven un <svg> listo para mostrar o imprimir. */

/* ================================== QR ================================== */

// Palabras de corrección de error por bloque y cantidad de bloques (nivel M), versiones 1 a 10
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
const MAX_VERSION = 10

function rawModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2
    r -= (25 * n - 10) * n - 55
    if (ver >= 7) r -= 36
  }
  return r
}

function dataCodewords(ver: number): number {
  return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver]
}

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function rsDivisor(degree: number): number[] {
  const result: number[] = []
  for (let i = 0; i < degree - 1; i++) result.push(0)
  result.push(1)
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 2)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor) })
  }
  return result
}

function utf8Bytes(text: string): number[] {
  const out: number[] = []
  const enc = encodeURIComponent(text)
  for (let i = 0; i < enc.length; i++) {
    if (enc[i] === '%') { out.push(parseInt(enc.substr(i + 1, 2), 16)); i += 2 } else out.push(enc.charCodeAt(i))
  }
  return out
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0

export function qrMatrix(text: string): boolean[][] {
  const bytes = utf8Bytes(text)
  let ver = 1
  for (; ver <= MAX_VERSION; ver++) {
    const countBits = ver < 10 ? 8 : 16
    if (4 + countBits + 8 * bytes.length <= dataCodewords(ver) * 8) break
  }
  if (ver > MAX_VERSION) throw new Error('El texto es demasiado largo para el código QR')
  const size = ver * 4 + 17

  // 1) Bits de datos
  const bits: number[] = []
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(0x4, 4)
  put(bytes.length, ver < 10 ? 8 : 16)
  bytes.forEach(b => put(b, 8))
  const capBits = dataCodewords(ver) * 8
  put(0, Math.min(4, capBits - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]
    data.push(v)
  }

  // 2) Corrección de errores e intercalado
  const nb = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver]
  const raw = Math.floor(rawModules(ver) / 8)
  const shortBlocks = nb - (raw % nb)
  const shortLen = Math.floor(raw / nb)
  const div = rsDivisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < nb; i++) {
    const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1)
    const dat = data.slice(k, k + len)
    k += len
    const ecc = rsRemainder(dat, div)
    if (i < shortBlocks) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const all: number[] = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((blk, j) => { if (i !== shortLen - eccLen || j >= shortBlocks) all.push(blk[i]) })
  }

  // 3) Matriz
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const isFn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const setFn = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; isFn[y][x] = true }

  function drawFormat(mask: number) {
    const d = (0 << 3) | mask // nivel M = 0
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const b = ((d << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(b, i))
    setFn(8, 7, bit(b, 6)); setFn(8, 8, bit(b, 7)); setFn(7, 8, bit(b, 8))
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(b, i))
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(b, i))
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(b, i))
    setFn(8, size - 8, true)
  }

  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0) }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy))
      const xx = cx + dx, yy = cy + dy
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4)
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2
    const pos = [6]
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
  drawFormat(0)
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), c = Math.floor(i / 3)
      setFn(a, c, bit(b, i)); setFn(c, a, bit(b, i))
    }
  }

  // Datos en zigzag
  let idx = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const up = ((right + 1) & 2) === 0
        const y = up ? size - 1 - vert : vert
        if (!isFn[y][x] && idx < all.length * 8) {
          modules[y][x] = bit(all[idx >>> 3], 7 - (idx & 7))
          idx++
        }
      }
    }
  }

  // Máscara con menor penalización
  const applyMask = (m: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let inv: boolean
      switch (m) {
        case 0: inv = (x + y) % 2 === 0; break
        case 1: inv = y % 2 === 0; break
        case 2: inv = x % 3 === 0; break
        case 3: inv = (x + y) % 3 === 0; break
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break
        case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break
        case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break
        default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
      }
      if (!isFn[y][x] && inv) modules[y][x] = !modules[y][x]
    }
  }
  const penalty = (): number => {
    let p = 0
    const lines: boolean[][] = []
    for (let y = 0; y < size; y++) lines.push(modules[y])
    for (let x = 0; x < size; x++) lines.push(modules.map(r => r[x]))
    for (const line of lines) {
      let run = 1
      for (let i = 1; i <= size; i++) {
        if (i < size && line[i] === line[i - 1]) run++
        else { if (run >= 5) p += 3 + (run - 5); run = 1 }
      }
      const s = line.map(v => (v ? '1' : '0')).join('')
      for (const pat of ['000010111010', '010111010000']) {
        let from = 0
        for (;;) { const k = s.indexOf(pat, from); if (k < 0) break; p += 40; from = k + 1 }
      }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x]
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) p += 3
    }
    let dark = 0
    for (const r of modules) for (const v of r) if (v) dark++
    const total = size * size
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
    return p
  }
  let best = 0, bestP = Infinity
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m)
    const p = penalty()
    if (p < bestP) { bestP = p; best = m }
    applyMask(m)
  }
  applyMask(best); drawFormat(best)
  return modules
}

export function qrSvg(text: string, border = 2): string {
  const m = qrMatrix(text)
  const n = m.length
  let d = ''
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x + border},${y + border}h1v1h-1z`
  const s = n + border * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}

/* ============================== Code 128 ================================ */

const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

/** true si el texto se puede escribir en Code 128 (solo caracteres ASCII visibles). */
export function canCode128(text: string): boolean {
  return text.length > 0 && text.length <= 40 && /^[\x20-\x7e]+$/.test(text)
}

export function code128Svg(text: string, height = 60): string {
  if (!canCode128(text)) throw new Error('Texto no válido para Code 128')
  const START_B = 104, STOP = 106
  const values = [START_B]
  let sum = START_B
  for (let i = 0; i < text.length; i++) {
    const v = text.charCodeAt(i) - 32
    values.push(v)
    sum += v * (i + 1)
  }
  values.push(sum % 103, STOP)
  let x = 10 // zona de silencio
  let d = ''
  for (const v of values) {
    const pat = C128[v]
    for (let i = 0; i < pat.length; i++) {
      const w = Number(pat[i])
      if (i % 2 === 0) d += `M${x},0h${w}v${height}h-${w}z`
      x += w
    }
  }
  const width = x + 10
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges" preserveAspectRatio="none"><rect width="${width}" height="${height}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}
