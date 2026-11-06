#!/usr/bin/env node
/**
 * Build the PaperDesk relation-graph demo library used for screenshots and for
 * trying the relations features without touching a real library.
 *
 *   node scripts/make-demo-library.mjs [--out <dir>] [--force]
 *
 * The generated PDFs are tiny synthetic papers (no real content). One paper
 * cites another by DOI, one by arXiv id and one by title, so a citation sync
 * produces `cites` edges in addition to the hand-written typed relations.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'demo/library'
const force = args.includes('--force')
const out = path.resolve(process.env.INIT_CWD ?? repoRoot, outArg)

const lib = (name) => import(path.join(repoRoot, 'lib', name))

function pdf(lines) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  let content = 'BT /F1 10 Tf 54 740 Td '
  for (const line of lines) content += `(${esc(line)}) Tj 0 -13 Td `
  content += 'ET'
  objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`)
  const header = '%PDF-1.4\n'
  let body = ''
  const offsets = []
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(header) + Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(header) + Buffer.byteLength(body)
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  return Buffer.from(
    header + body + xref + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    'latin1',
  )
}

const wrap = (text, width = 86) => {
  const words = text.split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    if ((line + ' ' + word).trim().length > width) {
      lines.push(line.trim())
      line = word
    } else {
      line = `${line} ${word}`
    }
  }
  if (line.trim() !== '') lines.push(line.trim())
  return lines
}

const papers = [
  {
    key: 'flow',
    title: 'Flow Matching for Language Generation',
    authors: ['Alice Smith', 'Bob Jones'],
    year: 2026,
    venue: 'Journal of Synthetic Tests',
    doi: '10.1234/flowlm.2026',
    abstract: 'We study continuous-time flow matching for discrete language generation, mapping noise to token embeddings with a learned velocity field.',
    references: [],
    body: [
      'We propose a continuous-time flow matching objective for language generation.',
      'The model learns a velocity field that transports a prior to token embeddings.',
      'Sampling solves an ODE with 32 Euler steps in our experiments.',
    ],
  },
  {
    key: 'drift',
    title: 'Training-Time Drift for Generative Modeling',
    authors: ['Carol White', 'Dan Brown'],
    year: 2026,
    venue: 'arXiv',
    url: 'https://arxiv.org/abs/2601.01234',
    abstract: 'We replace inference-time iterations with a training-time drift field, reaching one-step generation while keeping the distributional target.',
    references: [
      'Smith, A., Jones, B. (2026). Flow Matching for Language Generation. Journal of Synthetic Tests. https://doi.org/10.1234/flowlm.2026',
    ],
    body: [
      'Drifting moves the iterative process from inference to training.',
      'A single forward pass matches the pushforward distribution.',
    ],
  },
  {
    key: 'discrete',
    title: 'Discrete Diffusion Language Models',
    authors: ['Eve Green', 'Frank Black'],
    year: 2025,
    venue: 'NeurIPS 2025',
    abstract: 'Masked discrete diffusion for language: corruption processes, sampling schedules and the trade-off between parallel decoding and quality.',
    references: [
      'Smith, A., Jones, B. (2026). Flow Matching for Language Generation. Journal of Synthetic Tests. https://doi.org/10.1234/flowlm.2026',
      'White, C., Brown, D. (2026). Training-Time Drift for Generative Modeling. arXiv:2601.01234.',
    ],
    body: [
      'Discrete diffusion corrupts tokens with a masking process and learns to reverse it.',
      'Parallel decoding reduces the number of sampling steps.',
    ],
  },
  {
    key: 'survey',
    title: 'Continuous-Time Generative Models: A Survey',
    authors: ['Grace Lee'],
    year: 2026,
    venue: 'arXiv',
    url: 'https://arxiv.org/abs/2602.09876',
    abstract: 'A survey of continuous-time generative models, comparing flow matching, diffusion and drifting across training and inference costs.',
    references: [
      'Smith, A., Jones, B. (2026). Flow Matching for Language Generation. Journal of Synthetic Tests. https://doi.org/10.1234/flowlm.2026',
      'White, C., Brown, D. (2026). Training-Time Drift for Generative Modeling. arXiv:2601.01234.',
      'Green, E., Black, F. (2025). Discrete Diffusion Language Models. NeurIPS 2025.',
    ],
    body: [
      'Continuous-time models trade training complexity for sampling efficiency.',
      'We compare flow matching, diffusion and training-time drifting.',
    ],
  },
]

async function main() {
  const { createPaper, updateMeta, listPapers } = await lib('library.js')
  const { addRelation, readRelations } = await lib('relations.js')
  const { syncCitationEdges } = await lib('references.js')

  if (force) await rm(out, { recursive: true, force: true })
  else {
    const existing = await readdir(out).catch(() => [])
    if (existing.length > 0) {
      throw new Error(`refusing to overwrite non-empty ${out} (pass --force)`)
    }
  }
  await mkdir(out, { recursive: true })

  const created = {}
  for (const paper of papers) {
    const lines = [
      paper.title,
      paper.authors.join(', '),
      `${paper.venue}, ${paper.year}`,
      '',
      ...wrap(`Abstract: ${paper.abstract}`),
      '',
      ...paper.body.flatMap((paragraph) => [...wrap(paragraph), '']),
    ]
    if (paper.references.length > 0) {
      lines.push('References')
      paper.references.forEach((reference, index) => {
        lines.push(`[${index + 1}] ${wrap(reference, 78)[0]}`)
        for (const extra of wrap(reference, 78).slice(1)) lines.push(`    ${extra}`)
      })
    }
    const result = await createPaper(out, {
      fileName: `${paper.key}.pdf`,
      bytes: pdf(lines),
      source: 'import',
      enrich: false,
      language: 'zh',
    })
    await updateMeta(out, result.id, {
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      venue: paper.venue,
      doi: paper.doi ?? '',
      url: paper.url ?? '',
      abstract: paper.abstract,
      tags: ['demo'],
    })
    created[paper.key] = result.id
  }

  const manual = [
    ['flow', 'drift', 'contrast', '训练时漂移 vs 推理时迭代', '两者对迭代位置的选择相反：一个在推理端迭代，一个把迭代放进训练。'],
    ['flow', 'discrete', 'method', '连续空间 vs 离散扩散', '都在做语言生成，但一个在连续嵌入空间定义场，一个在离散 token 上做扩散。'],
    ['drift', 'survey', 'related', '扩散生成综述', '综述把训练时漂移列为连续时间生成的一条路线。'],
    ['discrete', 'survey', 'same-topic', '离散语言模型综述', '综述覆盖离散扩散语言模型与并行解码。'],
    ['flow', 'survey', 'custom', '综述覆盖本方向', '综述把 Flow Matching 作为连续时间生成的代表方法之一。'],
  ]
  for (const [from, to, kind, label, note] of manual) {
    await addRelation(out, { from: created[from], to: created[to], kind, label, note, source: 'user' })
  }
  const citations = await syncCitationEdges(out, undefined, { maxPapers: 10 })
  const relations = await readRelations(out)
  const list = await listPapers(out)

  console.log(`demo library: ${out}`)
  console.log(`papers: ${list.length}`)
  console.log(`relations: ${relations.items.length} (manual ${manual.length}, citations +${citations.added.length})`)
  for (const relation of relations.items) {
    const from = list.find((paper) => paper.id === relation.from)?.title ?? relation.from
    const to = list.find((paper) => paper.id === relation.to)?.title ?? relation.to
    console.log(`- [${relation.kind}] ${from} ↔ ${to}${relation.label ? ` · ${relation.label}` : ''}`)
  }
  await writeFile(
    path.join(out, 'README.md'),
    [
      '# PaperDesk demo library',
      '',
      'Synthetic demo papers used to try the relation graph, AI discovery and citation sync.',
      'Open it in PaperDesk via 设置 → 库路径 → this folder (or copy it anywhere).',
      '',
      'Regenerate with `node scripts/make-demo-library.mjs --out <dir> --force` from the repo.',
      '',
      `- papers: ${list.length}`,
      `- relations: ${relations.items.length}`,
      '',
    ].join('\n'),
    'utf8',
  )
}

await main()
