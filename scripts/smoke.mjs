/**
 * End-to-end smoke test for the PaperDesk domain modules (no Harness process
 * needed). Run after `pnpm run build`:
 *
 *   node scripts/smoke.mjs [optional-real-pdf]
 *
 * It creates a throwaway library in the OS temp directory, generates a minimal
 * PDF, and exercises import → text extraction → notes/conflict → search →
 * inbox → bibtex → sync → delete. Exits non-zero on the first failed check.
 */
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib = (...parts) => path.join(here, '..', 'lib', ...parts)

const { ensureLayout, createPaper, getPaper, listPapers, deletePaper, readMeta, bibtexOf, importInbox } =
  await import(lib('library.js'))
const { appendToNotes, readNotes, writeNotes } = await import(lib('notes.js'))
const { addCard, updateCard, readCards } = await import(lib('cards.js'))
const { ensureText } = await import(lib('pdf.js'))
const { searchLibrary } = await import(lib('search.js'))
const { syncStatus } = await import(lib('sync.js'))
const { settingsHome, effectiveSettings, saveSettings } = await import(lib('settings.js'))

let failures = 0
let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Build a minimal, valid single-page PDF with extractable text. */
function minimalPdf(text = 'PaperDesk smoke test') {
  const objects = []
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  objects.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  )
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)

  const header = '%PDF-1.4\n'
  let body = ''
  const offsets = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(header) + Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(header) + Buffer.byteLength(body)
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  // Info object is optional; omit the reference to keep the file valid.
  const finalTrailer = trailer.replace(' /Info 6 0 R', '')
  return Buffer.from(header + body + xref + finalTrailer, 'latin1')
}

const root = await mkdtemp(path.join(os.tmpdir(), 'paperdesk-smoke-'))
const realPdf = process.argv[2]
console.log(`PaperDesk smoke test\n  library: ${root}`)

try {
  await ensureLayout(root)
  const layout = await stat(path.join(root, 'papers'))
  check('library layout created', layout.isDirectory())

  const pdfPath = path.join(root, '_inbox', 'sample-paper.pdf')
  await mkdir(path.dirname(pdfPath), { recursive: true })
  const pdfBytes = realPdf !== undefined ? await readFile(realPdf) : minimalPdf()
  await writeFile(pdfPath, pdfBytes)

  const created = await createPaper(root, {
    sourcePath: pdfPath,
    source: 'import',
    enrich: false,
    language: 'zh',
    device: 'smoke',
    meta: {
      title: 'PaperDesk smoke test',
      authors: ['Ada Lovelace'],
      year: 2026,
      abstract:
        'Diffusion language models are a new class of generative models. We show that diffusion language models can generate text with fewer sampling steps.',
    },
  })
  check('paper imported', /^[a-z0-9-]+$/.test(created.id), created.id)
  check('paper deduplicated flag is false', created.duplicated === false)
  check('title kept from explicit meta', created.meta.title === 'PaperDesk smoke test')
  check('auto tags derived from abstract', created.meta.tags.includes('diffusion-language-model'), created.meta.tags.join(','))

  const duplicate = await createPaper(root, {
    sourcePath: pdfPath,
    source: 'import',
    enrich: false,
    language: 'zh',
    device: 'smoke',
  })
  check('same PDF is deduplicated', duplicate.duplicated === true && duplicate.id === created.id)

  const meta = await readMeta(root, created.id)
  check('meta.json written', meta !== null && meta.authors.length === 1)
  check('pdf sha recorded', typeof meta?.pdfSha256 === 'string' && meta.pdfSha256.length === 64)

  const listed = await listPapers(root)
  check('listPapers returns the paper', listed.length === 1 && listed[0].pdfBytes > 0)

  const detail = await getPaper(root, created.id)
  check('getPaper returns detail', detail !== null && detail.meta.id === created.id)
  check('initial notes exist', detail?.notes.exists === true)

  const cardDoc = await addCard(root, created.id, {
    title: 'Context card',
    body: 'A conclusion from a multi-turn conversation.',
    tags: ['diffusion-model'],
    pages: [2],
    context: [
      { role: 'user', text: 'Why does this method work?' },
      { role: 'assistant', text: 'Because it aligns the reward with answer quality.' },
    ],
  })
  check(
    'card context persisted',
    cardDoc.items[0]?.context?.length === 2 && cardDoc.items[0]?.context?.[0]?.role === 'user',
  )
  const updatedCard = await updateCard(root, created.id, cardDoc.items[0].id, {
    context: [
      { role: 'user', text: 'Why?' },
      { role: 'assistant', text: 'Alignment.' },
      { role: 'user', text: 'What is the evidence?' },
    ],
  })
  check('card context appendable', updatedCard.items[0]?.context?.length === 3)
  check('readCards returns context', (await readCards(root, created.id)).items[0]?.context?.length === 3)

  // Text extraction (pdfjs) — real PDF may take longer.
  const text = await ensureText(root, created.id, {
    pdfAbs: path.join(root, 'papers', created.id, 'paper.pdf'),
    sha: meta.pdfSha256,
    force: true,
  })
  check('text extraction has pages', text.pageCount >= 1 && text.pages.length >= 1)
  const joined = text.pages.map((page) => page.text).join(' ')
  check('text contains expected content', realPdf !== undefined ? joined.trim().length > 50 : joined.includes('PaperDesk smoke test'), `${joined.length} chars`)

  // Notes: append + canonical section + conflict copy.
  const appended = await appendToNotes(
    root,
    { paperId: created.id, text: '第一条笔记：核心贡献是 xx。', section: 'points', by: 'agent' },
    { language: 'zh', device: 'smoke' },
  )
  check('note appended', appended.ok === true && appended.notes.markdown.includes('核心贡献'))
  check('canonical section heading present', appended.notes.markdown.includes('## 要点'))

  const stale = await writeNotes(root, created.id, '# 覆盖写入\n', { baseHash: 'deadbeef', device: 'smoke' })
  check('stale write becomes a conflict copy', stale.conflict === true && stale.ok === false, String(stale.conflictPath))
  const conflictExists = stale.conflictPath !== undefined
  check('conflict copy file exists', conflictExists && (await stat(path.join(root, stale.conflictPath)).then(() => true, () => false)))

  const fresh = await readNotes(root, created.id)
  const good = await writeNotes(root, created.id, `${fresh.markdown}\n\n补充一句。\n`, { baseHash: fresh.hash, device: 'smoke' })
  check('fresh write with baseHash succeeds', good.ok === true && !good.conflict)

  const hits = await searchLibrary(root, '核心贡献')
  check('search finds notes content', hits.length === 1 && hits[0].field === 'notes', JSON.stringify(hits[0]?.field))

  // Inbox import of a second PDF.
  await writeFile(path.join(root, '_inbox', 'second.pdf'), minimalPdf('Second paper'))
  const importedIds = await importInbox(root, 'zh')
  check('inbox import works', importedIds.length === 1, importedIds.join(','))
  const afterInbox = await listPapers(root)
  check('inbox paper listed', afterInbox.length === 2)

  const bib = await bibtexOf(root)
  check('bibtex export', bib.includes('@article') && bib.includes('PaperDesk smoke test'))

  const sync = await syncStatus(root, 'smoke')
  check('sync status reports cloud kind', typeof sync.cloud.kind === 'string' && sync.cloud.kind.length > 0)
  check('sync status counts pdfs', sync.pdfCount >= 2)
  check('sync status includes the conflict copy', sync.conflicts.length >= 1, String(sync.conflicts.length))

  const deleted = await deletePaper(root, created.id)
  const trashedAbs = path.isAbsolute(deleted.trashed) ? deleted.trashed : path.join(root, deleted.trashed)
  check('delete moves the paper to trash', await stat(trashedAbs).then(() => true, () => false))
  check('trash is outside papers/', !path.relative(root, trashedAbs).startsWith(path.join('papers', '')))

  // Settings resolution.
  const config = { libraryPath: '', language: 'zh', enrich: true, autoImportInbox: true, maxPdfBytes: 1024 }
  const settings = effectiveSettings(config)
  check('effectiveSettings resolves a settings file', settings.settingsFile.endsWith('settings.json'))
  check('settings source is recognized', ['file', 'config', 'env', 'none'].includes(settings.source))
  void saveSettings
  void settingsHome
} catch (error) {
  failures += 1
  console.error('\nUncaught failure:', error instanceof Error ? error.stack : error)
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('SMOKE OK')
}
