import { loadPdfjs, pdfjsAsset } from './pdfjs.js'

export interface PageImage {
  type: 'image'
  mediaType: 'image/jpeg'
  data: string
  name: string
}

/** Render the original PDF, never a screenshot of the current zoom or overlays. */
export async function renderPageImages(src: string, pages: readonly number[]): Promise<PageImage[]> {
  const requested = [...new Set(pages)]
  if (
    requested.length < 1 ||
    requested.length > 3 ||
    requested.some((page) => !Number.isInteger(page) || page < 1)
  )
    throw new Error('请选择 1–3 个有效页码。')
  const pdfjs = await loadPdfjs()
  const loadingTask = pdfjs.getDocument({
    url: src,
    cMapUrl: pdfjsAsset('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: pdfjsAsset('standard_fonts/'),
    wasmUrl: pdfjsAsset('wasm/'),
  })
  try {
    const doc = await loadingTask.promise
    const images: PageImage[] = []
    for (const pageNumber of requested) {
      if (pageNumber > doc.numPages) throw new Error(`页码 ${pageNumber} 超出论文范围。`)
      const page = await doc.getPage(pageNumber)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: 2000 / Math.max(base.width, base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const canvasContext = canvas.getContext('2d')
      if (!canvasContext) throw new Error('无法生成论文页图片。')
      await page.render({ canvasContext, canvas, viewport }).promise
      const data = canvas.toDataURL('image/jpeg', 0.92).split(',')[1]
      if (!data || data.length > 5_500_000) throw new Error('论文页图片过大，请减少页数后重试。')
      images.push({ type: 'image', mediaType: 'image/jpeg', data, name: `paper-page-${pageNumber}.jpg` })
      canvas.width = 0
      canvas.height = 0
      page.cleanup?.()
    }
    return images
  } finally {
    await loadingTask.destroy()
  }
}
