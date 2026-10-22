/**
 * Extraction du texte d'une facture dans le NAVIGATEUR (aucune clé API, aucun serveur) :
 *  - PDF : couche texte via pdfjs-dist ; si une page n'a pas de texte (scan), rendu canvas puis OCR.
 *  - Image (JPEG/PNG/WebP) : OCR Tesseract.js (fra + ara + eng).
 * pdfjs et tesseract.js sont chargés à la demande (import dynamique) ; leurs workers, le cœur WASM et les
 * données de langue viennent du CDN jsdelivr (gratuit), autorisé dans la CSP (src/lib/security-headers.ts).
 * Le fichier ne quitte pas le navigateur.
 */

export type OcrStage = 'pdf' | 'ocr_load' | 'ocr' | 'done'
export type OcrProgress = { stage: OcrStage; progress: number; page?: number; pages?: number }
/** `image` : 1re page scannée d'un PDF en JPEG (data URL) pour l'affinage IA par vision. */
export type OcrResult = { text: string; method: 'pdf-text' | 'ocr' | 'pdf-ocr'; pages: number; image?: string | null }

/** Limite du corps de requête Vercel (4,5 Mo) : l'image envoyée à l'IA reste sous ~3 Mo (≈ 4 Mo en base64). */
const AI_IMAGE_MAX_BYTES = 3 * 1024 * 1024
const AI_IMAGE_MAX_SIDE = 2000

function canvasToJpeg(src: CanvasImageSource, w: number, h: number): string | null {
  const scale = Math.min(1, AI_IMAGE_MAX_SIDE / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale)
  c.height = Math.round(h * scale)
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(src, 0, 0, c.width, c.height)
  for (const q of [0.85, 0.7, 0.5]) {
    const url = c.toDataURL('image/jpeg', q)
    if (url.length * 0.75 <= AI_IMAGE_MAX_BYTES) return url
  }
  return null
}

export const MAX_INVOICE_FILE_BYTES = 5 * 1024 * 1024
export const ACCEPTED_INVOICE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const OCR_LANGS = 'fra+ara+eng'
const MAX_PDF_PAGES = 5
const CDN = 'https://cdn.jsdelivr.net/npm'

type TesseractWorker = { recognize: (img: unknown) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> }

async function createOcrWorker(onProgress: (p: OcrProgress) => void, page?: number, pages?: number): Promise<TesseractWorker> {
  const { createWorker } = await import('tesseract.js')
  onProgress({ stage: 'ocr_load', progress: 0, page, pages })
  return (await createWorker(OCR_LANGS, 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress({ stage: 'ocr', progress: m.progress, page, pages })
      else onProgress({ stage: 'ocr_load', progress: m.progress ?? 0, page, pages })
    },
  })) as unknown as TesseractWorker
}

async function ocrImage(img: Blob | HTMLCanvasElement, onProgress: (p: OcrProgress) => void, page?: number, pages?: number): Promise<string> {
  const worker = await createOcrWorker(onProgress, page, pages)
  try {
    const { data } = await worker.recognize(img)
    return data.text
  } finally {
    await worker.terminate()
  }
}

/** Lignes d'une page PDF reconstituées à partir des positions (y puis x). */
function itemsToLines(items: Array<{ str?: string; transform?: number[] }>): string {
  const rows = new Map<number, Array<{ x: number; s: string }>>()
  for (const it of items) {
    if (!it.str || !it.transform) continue
    const y = Math.round(it.transform[5] / 3) * 3
    const x = it.transform[4]
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y)!.push({ x, s: it.str })
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, cells]) => cells.sort((a, b) => a.x - b.x).map((c) => c.s).join('  ').replace(/\s{3,}/g, '  ').trim())
    .filter(Boolean)
    .join('\n')
}

async function extractPdf(file: File, onProgress: (p: OcrProgress) => void): Promise<OcrResult> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = `${CDN}/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
  const data = new Uint8Array(await file.arrayBuffer())
  const loadingTask = pdfjs.getDocument({
    data,
    cMapUrl: `${CDN}/pdfjs-dist@${pdfjs.version}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${CDN}/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
  })
  const doc = await loadingTask.promise
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES)
  const texts: string[] = []
  let usedOcr = false
  let image: string | null = null
  try {
    for (let i = 1; i <= pages; i++) {
      onProgress({ stage: 'pdf', progress: (i - 1) / pages, page: i, pages })
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      let text = itemsToLines(content.items as Array<{ str?: string; transform?: number[] }>)
      // Page scannée (pas / peu de texte) : rendu à ~200 dpi puis OCR
      if (text.replace(/\s/g, '').length < 40) {
        const viewport = page.getViewport({ scale: 2.8 })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const ctx = canvas.getContext('2d')
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport, canvas }).promise
          text = await ocrImage(canvas, onProgress, i, pages)
          if (!usedOcr) image = canvasToJpeg(canvas, canvas.width, canvas.height)
          usedOcr = true
        }
      }
      texts.push(text)
    }
  } finally {
    await loadingTask.destroy() // pdfjs 6 : destroy() est porté par la tâche de chargement
  }
  onProgress({ stage: 'done', progress: 1 })
  return { text: texts.join('\n'), method: usedOcr ? 'pdf-ocr' : 'pdf-text', pages, image }
}

/** Texte de la facture (PDF ou image), avec progression. Lève une Error('too_large' | 'unsupported'). */
export async function extractInvoiceText(file: File, onProgress: (p: OcrProgress) => void = () => {}): Promise<OcrResult> {
  if (file.size > MAX_INVOICE_FILE_BYTES) throw new Error('too_large')
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (isPdf) return extractPdf(file, onProgress)
  if (!file.type.startsWith('image/')) throw new Error('unsupported')
  const text = await ocrImage(file, onProgress)
  onProgress({ stage: 'done', progress: 1 })
  return { text, method: 'ocr', pages: 1 }
}

/** Image en data URL pour l'affinage IA (vision) : envoyée telle quelle si petite, sinon réduite en JPEG ; null si impossible. */
export async function imageDataUrlForAi(file: File, maxBytes = AI_IMAGE_MAX_BYTES): Promise<string | null> {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return null
  if (file.size <= maxBytes) {
    return new Promise((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(typeof r.result === 'string' ? r.result : null)
      r.onerror = () => resolve(null)
      r.readAsDataURL(file)
    })
  }
  try {
    const bmp = await createImageBitmap(file)
    try { return canvasToJpeg(bmp, bmp.width, bmp.height) } finally { bmp.close() }
  } catch {
    return null
  }
}
