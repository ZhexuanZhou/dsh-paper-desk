import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'paperdesk-highlight-check-'))
let checks = 0
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks++; console.log(`ok ${name}`) }
const run = (str, x, width, extra = {}) => ({ str, transform: [10, 0, 0, 10, x, 100], width, height: 10, fontName: 'body', dir: 'ltr', hasEOL: false, ...extra })
try {
  const module = path.join(root, 'selection.mjs')
  await build({ entryPoints: ['client/pdfTextSelection.ts'], bundle: true, platform: 'node', format: 'esm', outfile: module })
  const { mergeTextItems, findUniqueQuote, normaliseTextRects } = await import(pathToFileURL(module))
  const items = [run('fast', 20, 20), run(' ', 40, 3), run('weights', 43, 35, { hasEOL: true })]
  const before = JSON.stringify(items)
  const merged = mergeTextItems(items)
  check('touching same-font fragments keep their text', merged.map((item) => item.str), ['fast weights'])
  check('merged run retains real PDF width for horizontal calibration', merged[0].width, 58)
  check('source metrics are never mutated', JSON.stringify(items), before)
  check('a single original line retains its PDF width', mergeTextItems([run('A long line', 10, 324.75)])[0].width, 324.75)
  check('font changes preserve separate math runs', mergeTextItems([run('length ', 10, 30), run('N', 40, 8, { fontName: 'math' })]).length, 2)
  check('different font sizes cannot be merged', mergeTextItems([run('a', 10, 5), run('b', 15, 5, { transform: [8, 0, 0, 8, 15, 100] })]).length, 2)
  check('column gaps are not converted into stretched text', mergeTextItems([run('left', 10, 20), run('right', 200, 20)]).length, 2)
  check('backwards/overlapping runs stay distinct', mergeTextItems([run('right', 200, 20), run('left', 10, 20)]).length, 2)
  check('explicit line ends prevent accidental joining', mergeTextItems([run('line', 10, 20, { hasEOL: true }), run('next', 30, 20)]).length, 2)
  const marker = { type: 'beginMarkedContent', id: 'paragraph' }
  check('tagged PDF boundaries are retained', mergeTextItems([marker, run('text', 10, 20), { type: 'endMarkedContent' }]).map((item) => item.type ?? item.str), ['beginMarkedContent', 'text', 'endMarkedContent'])

  const segments = ['alpha', '\n', '  beta ', 'length ', 'N', '. As the context extends']
  check('saved quote resolves across line breaks and font fragments', findUniqueQuote(segments, 'alpha beta length N'), { start: { segment: 0, offset: 0 }, end: { segment: 4, offset: 1 } })
  check('partial-node matching stops before unselected following text', findUniqueQuote(['before selected after'], 'selected'), { start: { segment: 0, offset: 7 }, end: { segment: 0, offset: 15 } })
  check('repeated quotes are not silently reanchored', findUniqueQuote(['same text same text'], 'same text'), null)
  check('overlapping matches are also ambiguous', findUniqueQuote(['a a a'], 'a a'), null)
  check('missing or empty quotes are not guessed', [findUniqueQuote(['alpha'], 'beta'), findUniqueQuote(['alpha'], '')], [null, null])
  check('UTF-16 offsets remain correct for browser Range', findUniqueQuote(['A 😁', ' N'], '😁 N'), { start: { segment: 0, offset: 2 }, end: { segment: 1, offset: 2 } })

  const page = { left: 100, top: 200, width: 600, height: 800 }
  const boxes = [{ left: 110, top: 220, right: 170, bottom: 230 }, { left: 110, top: 220, right: 170, bottom: 230 }, { left: 90, top: 190, right: 130, bottom: 210 }]
  check('duplicate glyph rectangles are removed and edges clipped', normaliseTextRects(boxes, page), [{ x: 10 / 600, y: 20 / 800, w: 60 / 600, h: 10 / 800 }, { x: 0, y: 0, w: 30 / 600, h: 10 / 800 }])
  const scaled = boxes.map((box) => Object.fromEntries(Object.entries(box).map(([key, value]) => [key, value * 2])))
  check('normalised rectangles stay invariant across zoom', normaliseTextRects(scaled, { left: 200, top: 400, width: 1200, height: 1600 }), normaliseTextRects(boxes, page))
  check('invalid page and glyph geometry produce no marks', [normaliseTextRects(boxes, { ...page, width: 0 }), normaliseTextRects([{ left: NaN, top: 0, right: 10, bottom: 10 }], page)], [[], []])

  if (process.argv[2]) {
    const task = getDocument({ data: new Uint8Array(await readFile(process.argv[2])), useSystemFonts: true, verbosity: 0 })
    try {
      const doc = await task.promise
      for (let page = 1; page <= Math.min(3, doc.numPages); page++) {
        const content = await (await doc.getPage(page)).getTextContent({ includeMarkedContent: true, disableNormalization: true })
        const output = mergeTextItems(content.items)
        check(`real PDF p${page}: text content is preserved`, output.map((item) => item.str ?? '').join(''), content.items.map((item) => item.str ?? '').join(''))
        check(`real PDF p${page}: widths remain positive`, output.filter((item) => item.str?.trim()).every((item) => item.width > 0), true)
        console.log(`p${page}: ${content.items.length} source items → ${output.length} calibrated items`)
        const sourceLine = content.items.find((item) => item.str?.startsWith('The vanilla self-attention'))
        if (sourceLine) check('original problem line retains its 324pt width instead of zero', output.find((item) => item.str === sourceLine.str).width, sourceLine.width)
      }
    } finally { await task.destroy() }
  }
  console.log(`${checks} PDF highlight checks passed`)
} finally { await rm(root, { recursive: true, force: true }) }
