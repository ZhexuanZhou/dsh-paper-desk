import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { expectedLinkRect, pdfLinksFixture } from './fixtures/pdf-links.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'paperdesk-link-check-'))
let checks = 0
function equalBounds(actual, expected, label) {
  if (expected === null) assert.equal(actual, null, label)
  else {
    assert.notEqual(actual, null, label)
    for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-10, `${label}: ${key}`)
  }
  checks++
}
try {
  const modulePath = path.join(root, 'geometry.mjs')
  await build({ entryPoints: ['client/pdfLinkGeometry.ts'], bundle: true, format: 'esm', platform: 'node', outfile: modulePath })
  const { normaliseLinkRect } = await import(pathToFileURL(modulePath))
  const documents = [
    ['normal', pdfLinksFixture()],
    ['cropped-user-unit', pdfLinksFixture({ cropBox: [30, 50, 580, 760], userUnit: 2 })],
  ]
  if (process.argv[2]) documents.push(['original-user-PDF', await readFile(process.argv[2])])
  for (const [name, data] of documents) {
    const task = getDocument({ data: new Uint8Array(data), useSystemFonts: true })
    try {
      const doc = await task.promise
      const pageCount = name === 'original-user-PDF' ? 1 : doc.numPages
      for (let n = 1; n <= pageCount; n++) {
        const page = await doc.getPage(n)
        const links = (await page.getAnnotations()).filter((item) => item.subtype === 'Link')
        assert.ok(links.length > 0, 'Fixture must contain actual PDF link annotations')
        const rotations = name === 'original-user-PDF' ? [0, 90, 180, 270] : [page.rotate]
        for (const rotation of rotations) {
          for (const scale of [0.5, 2 / 3, 1, 4 / 3, 2, 8 / 3]) {
            const viewport = page.getViewport({ scale, rotation })
            for (const [index, link] of links.entries()) {
              equalBounds(normaliseLinkRect(viewport, link.rect), expectedLinkRect(link.rect, page.view, rotation), `${name} p${n} r${rotation} s${scale} link${index}`)
              equalBounds(normaliseLinkRect(viewport, [...link.rect.slice(2), ...link.rect.slice(0, 2)]), expectedLinkRect(link.rect, page.view, rotation), 'Reversed PDF corners')
            }
          }
        }
      }
      const page = await doc.getPage(1)
      const viewport = page.getViewport({ scale: 4 / 3 })
      for (const rect of [[0, 700, 100, 800], [-500, -400, -100, -200], [50, 50, 50, 100]]) {
        equalBounds(normaliseLinkRect(viewport, rect), expectedLinkRect(rect, page.view, page.rotate), `${name}: cropped/empty boundary`)
      }
      for (const rect of [[], [0, 1, 2], [NaN, 0, 20, 20], [0, 0, Infinity, 30]]) equalBounds(normaliseLinkRect(viewport, rect), null, 'Invalid PDF rectangle')
      equalBounds(normaliseLinkRect({ width: 600, height: 800 }, [10, 10, 20, 20]), null, 'Missing transform never creates a raw-coordinate hotspot')
      equalBounds(normaliseLinkRect({ ...viewport, convertToViewportPoint: () => [NaN, 1] }, [10, 10, 20, 20]), null, 'Invalid transformed coordinates')
      equalBounds(normaliseLinkRect({ width: 0, height: 800, convertToViewportPoint: () => [1, 1] }, [10, 10, 20, 20]), null, 'Invalid viewport dimensions')
      console.log(`ok ${name}: rotations, scales, reversed corners and boundaries`)
    } finally { await task.destroy() }
  }
  console.log(`${checks} PDF link geometry checks passed`)
} finally { await rm(root, { recursive: true, force: true }) }
