/** Small valid PDF with independently painted link frames and four page rotations. */
export const LINK_RECTS = [
  { name: 'UPPER EXTERNAL LINK', rect: [80, 620, 300, 650] },
  { name: 'GO TO NEXT ROTATION PAGE', rect: [80, 500, 320, 535], internal: true },
  { name: 'LOWER EXTERNAL LINK', rect: [370, 160, 540, 190] },
]

export function pdfLinksFixture({ cropBox, userUnit = 1 } = {}) {
  const objects = []
  const reserve = () => { objects.push(''); return objects.length }
  const add = (body) => { const id = reserve(); objects[id - 1] = body; return id }
  const catalog = reserve(), pages = reserve()
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageIds = [reserve(), reserve(), reserve(), reserve()]
  const rotations = [0, 90, 180, 270]
  for (const [index, rotation] of rotations.entries()) {
    let content = `BT /F1 20 Tf 80 720 Td (PAGE ${index + 1} - ROTATION ${rotation}) Tj ET\n`
    const annotations = LINK_RECTS.map((link, linkIndex) => {
      const [x1, y1, x2, y2] = link.rect
      content += `0.2 0.4 0.6 RG 1 w ${x1} ${y1} ${x2 - x1} ${y2 - y1} re S\n`
      content += `0 g BT /F1 12 Tf ${x1 + 5} ${y1 + 10} Td (${link.name}) Tj ET\n`
      const action = link.internal
        ? `/Dest [${pageIds[(index + 1) % pageIds.length]} 0 R /Fit]`
        : `/A << /S /URI /URI (https://example.invalid/pdf-link-check/${rotation}/${linkIndex}) >>`
      return add(`<< /Type /Annot /Subtype /Link /Rect [${link.rect.join(' ')}] /Border [0 0 0] ${action} >>`)
    })
    const stream = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`)
    objects[pageIds[index] - 1] = `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] ${cropBox ? `/CropBox [${cropBox.join(' ')}]` : ''} /UserUnit ${userUnit} /Rotate ${rotation} /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R /Annots [${annotations.map((id) => `${id} 0 R`).join(' ')}] >>`
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`
  objects[pages - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count 4 >>`
  let body = '%PDF-1.7\n'
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(body)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'ascii')
}

/** Independent expected bounds from PDF page-box and right-angle rotation rules. */
export function expectedLinkRect(rect, viewBox, rotation) {
  const [vx, vy, maxX, maxY] = viewBox
  const width = maxX - vx, height = maxY - vy
  const x1 = Math.max(vx, Math.min(maxX, Math.min(rect[0], rect[2]))) - vx
  const x2 = Math.max(vx, Math.min(maxX, Math.max(rect[0], rect[2]))) - vx
  const y1 = Math.max(vy, Math.min(maxY, Math.min(rect[1], rect[3]))) - vy
  const y2 = Math.max(vy, Math.min(maxY, Math.max(rect[1], rect[3]))) - vy
  if (x2 <= x1 || y2 <= y1) return null
  switch (rotation) {
    case 0: return { x: x1 / width, y: (height - y2) / height, w: (x2 - x1) / width, h: (y2 - y1) / height }
    case 90: return { x: y1 / height, y: x1 / width, w: (y2 - y1) / height, h: (x2 - x1) / width }
    case 180: return { x: (width - x2) / width, y: y1 / height, w: (x2 - x1) / width, h: (y2 - y1) / height }
    case 270: return { x: (height - y2) / height, y: (width - x2) / width, w: (y2 - y1) / height, h: (x2 - x1) / width }
    default: throw new Error('Expected a right-angle page rotation')
  }
}
