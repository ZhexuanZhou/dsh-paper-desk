/**
 * Prompt construction: the system-prompt section that teaches every agent about
 * the library, and the ready-to-send prompts behind the reader's assist bar.
 */
import type {
  AnnotationDocument,
  RelationsDocument,
  AssistPayload,
  AssistRequest,
  AssistTask,
  EffectiveSettings,
  NotesDocument,
  PaperMeta,
} from './types.js'

const TASK_LABEL: Record<AssistTask, { zh: string; en: string }> = {
  summary: { zh: '总结这篇论文', en: 'Summarize this paper' },
  method: { zh: '精读方法部分', en: 'Close read of the method' },
  critique: { zh: '批判性审阅', en: 'Critical review' },
  related: { zh: '找相关工作', en: 'Find related work' },
  questions: { zh: '生成理解问题', en: 'Generate study questions' },
  quote: { zh: '解释选中内容', en: 'Explain the selected passage' },
  compare: { zh: '多篇论文对比', en: 'Compare these papers' },
  discover: { zh: '发现论文关联', en: 'Discover paper relations' },
  custom: { zh: '与 Agent 讨论这篇论文', en: 'Discuss this paper with the agent' },
}

const TASK_INSTRUCTION: Record<AssistTask, { zh: string; en: string }> = {
  summary: {
    zh: '请用中文给出结构化总结：1) 一句话结论；2) 研究问题与动机；3) 方法与关键设计；4) 主要结果与证据（标注页码/图表）；5) 局限与可复用点。',
    en: 'Produce a structured summary: 1) one-sentence takeaway; 2) problem and motivation; 3) method and key design choices; 4) main results with evidence (cite pages/figures); 5) limitations and reusable ideas.',
  },
  method: {
    zh: '请精读方法/实验部分，逐步解释作者的建模假设、算法流程、关键公式（用 Markdown 数学符号）、超参数与实现细节，并指出哪些地方依赖了未说明的前提。',
    en: 'Close-read the method/experiments: explain assumptions, algorithm flow, key equations (Markdown math), hyperparameters and implementation details, and flag unstated prerequisites.',
  },
  critique: {
    zh: '请以审稿人视角批判性审阅：贡献是否成立、实验是否充分、基线是否公平、结论是否有过度声明，并给出可执行的改进实验建议。',
    en: 'Review as a referee: are the claims supported, are experiments sufficient, are baselines fair, is the conclusion overclaimed? Add concrete follow-up experiments.',
  },
  related: {
    zh: '请梳理与该论文最相关的工作脉络（前作、同期、后续），说明它相对先前工作的增量，并指出值得追读的具体论文。如有需要可以用 web 搜索核实引用信息。',
    en: 'Map the related-work lineage (prior, contemporaneous, follow-up work), state the delta over prior art, and name specific papers worth reading. Use web search to verify citations when needed.',
  },
  questions: {
    zh: '请生成 8-12 个由浅入深的理解问题（含答案要点），覆盖定义、方法细节、假设、实验设计与开放问题，帮助我检验是否真正读懂了这篇论文。',
    en: 'Generate 8-12 study questions from basic to advanced (with answer keys) covering definitions, method details, assumptions, experimental design and open problems, so I can test my understanding.',
  },
  quote: {
    zh: '请解释我选中的这段内容：它在论文中的作用、涉及的关键概念/公式、成立的前提，以及它和前后文的关系。先直接回答，再补充必要的背景；如果有歧义，明确指出。',
    en: 'Explain the passage I selected: its role in the paper, the key concepts/equations involved, the assumptions it relies on, and how it connects to the surrounding text. Answer directly first, then add necessary background; flag any ambiguity.',
  },
  compare: {
    zh: '请对比这些论文：先给出结构化对比表，再给横向结论，最后给出建议的论文关联（引用/相关/方法/对比）。所有结论尽量标注页码。',
    en: 'Compare these papers: a structured comparison table, then cross-paper conclusions, then suggested relations (cites/related/method/contrast). Cite pages where possible.',
  },
  discover: {
    zh: '请分析论文库中的论文，提出候选关联（引用/相关/方法/对比/同主题/自定义），并说明理由；只提出有证据的关联。',
    en: 'Analyse the library and propose candidate paper relations (cites/related/method/contrast/same-topic/custom) with evidence; only propose supported relations.',
  },
  custom: {
    zh: '请阅读这篇论文，等我提问；先给出 5 条最值得关注的要点，然后回答我的问题。',
    en: 'Read this paper and wait for my questions; first list the five most important points, then answer my questions.',
  },
}

function isZh(settings: EffectiveSettings): boolean {
  return settings.language !== 'en'
}

/**
 * System-prompt section describing the library. Returns '' when the library is
 * not configured, so an unconfigured install adds no prompt noise.
 */
export function systemPromptText(settings: EffectiveSettings): string {
  if (settings.libraryPath.length === 0) return ''
  const zh = isZh(settings)
  if (zh) {
    return [
      `用户有一个名为 PaperDesk 的本地论文库，根目录：${settings.libraryPath}。`,
      '处理论文相关问题时的约定：',
      '- 先用 `paper_list` / `paper_search` 定位论文，再用 `paper_info`、`paper_text` 读取元数据与正文（按页读取，避免一次读入全文）。',
      '- 回答时尽量标注页码或图表编号；不确定的内容明确说明是推断。',
      '- 用户可能已在 PDF 上做高亮/划线/提问：先用 `paper_annotations` 读取这些标注（含页码、原文、批注），回答时优先回应用户标记过的内容。',
      '- 论文库里还有用户整理的「笔记卡片」与「论文关联图谱」：需要复用已有结论时先读 `paper_cards`；做跨论文分析或找相关工作时用 `paper_relations` 了解已有关系。',
      '- 普通讨论只读。只有用户明确要求保存笔记时，才用 `paper_note_append` 追加，并在回复中说明已记录；不要自行把推断保存成已确认结论。',
      '- 需要新论文入库时用 `paper_add` 传入本机绝对路径；不要直接改写论文库里的文件结构。',
      '- 该目录可能通过网盘同步，不要做批量重命名或移动目录。',
    ].join('\n')
  }
  return [
    `The user keeps a local paper library named PaperDesk at: ${settings.libraryPath}.`,
    'When working on papers:',
    '- Locate papers with `paper_list` / `paper_search`, then read metadata and text with `paper_info` and `paper_text` (page by page; avoid loading whole papers).',
    '- Cite page numbers or figure/table numbers; mark anything uncertain as inference.',
    '- The user may have highlighted/underlined/asked questions on the PDF: read them with `paper_annotations` (page, quote, comment) and prefer addressing what the user already marked.',
    '- The library also has distilled note cards (`paper_cards`) and a paper relation graph (`paper_relations`): reuse the user\'s earlier conclusions and check existing relations for cross-paper analysis.',
    '- Ordinary discussion is read-only. Only use `paper_note_append` when the user explicitly asks to save notes; distinguish inferences from verified conclusions.',
    '- Import new papers with `paper_add` and an absolute Host path; do not restructure the library directories.',
    '- The directory may be synced through a cloud drive: avoid bulk renames or moves.',
  ].join('\n')
}

function authorsLine(meta: PaperMeta): string {
  const authors = meta.authors.length > 0 ? meta.authors.join(', ') : '（未知作者 / unknown authors）'
  const year = meta.year === null ? '' : ` (${meta.year})`
  return `${authors}${year}`
}

/** Compact rendering of the reader's annotations for the prompt. */
function annotationsBlock(annotations: AnnotationDocument | undefined, zh: boolean): string {
  if (annotations === undefined || annotations.items.length === 0) return ''
  const highlights = annotations.items.filter((item) => item.kind === 'highlight' || item.kind === 'underline')
  const questions = annotations.items.filter((item) => item.kind === 'question')
  const lines: string[] = [
    zh
      ? `读者在这篇论文里已有 ${highlights.length} 处高亮/划线、${questions.length} 条提问，记录如下（可结合这些关注点回答）：`
      : `The reader already marked ${highlights.length} highlight(s)/underline(s) and asked ${questions.length} question(s) in this paper:`,
  ]
  const shown = annotations.items.slice(0, 20)
  for (const item of shown) {
    const where = zh ? `第 ${item.page} 页` : `p.${item.page}`
    const kind = item.kind === 'question' ? (zh ? '提问' : 'question') : item.kind === 'underline' ? (zh ? '划线' : 'underline') : (zh ? '高亮' : 'highlight')
    const quote = item.quote.replace(/\s+/g, ' ').trim().slice(0, 220)
    const comment = item.comment.trim()
    lines.push(`- [${where} · ${kind}] “${quote}”${comment.length > 0 ? ` — ${zh ? '批注' : 'note'}: ${comment.slice(0, 220)}` : ''}`)
  }
  if (annotations.items.length > shown.length) {
    lines.push(zh ? `（另有 ${annotations.items.length - shown.length} 条未列出）` : `(+${annotations.items.length - shown.length} more)`)
  }
  return lines.join('\n')
}

/** Build the prompt pre-filled into a new session for one paper + task. */
export function assistPayload(
  input: AssistRequest,
  meta: PaperMeta,
  notes: NotesDocument,
  settings: EffectiveSettings,
  annotations?: AnnotationDocument,
): AssistPayload {
  const zh = isZh(settings)
  const task = TASK_LABEL[input.task][zh ? 'zh' : 'en']
  const instruction = TASK_INSTRUCTION[input.task][zh ? 'zh' : 'en']
  const root = settings.libraryPath
  const paperPath = `${root}/papers/${meta.id}`
  const notesHint =
    notes.exists && notes.markdown.replace(/\s+/g, '').length > 40
      ? zh
        ? '这篇论文已有笔记，请先读 `paper_notes_read` 了解我已有的理解，避免重复。'
        : 'This paper already has notes; read them with `paper_notes_read` first and avoid repeating them.'
      : ''
  const extra = (input.extra ?? '').trim()
  const quoted = meta.abstract.length > 0 ? `${zh ? '摘要' : 'Abstract'}: ${meta.abstract.slice(0, 1200)}` : ''
  const quote = (input.quote ?? '').trim().slice(0, 2000)
  const question = (input.question ?? '').trim().slice(0, 1000)
  const selectionBlock =
    quote.length === 0
      ? ''
      : zh
        ? [`读者选中的内容（第 ${input.page ?? 1} 页）：`, `> ${quote.replace(/\n+/g, '\n> ')}`, question.length > 0 ? `我的问题：${question}` : ''].join('\n')
        : [`Selected passage (p.${input.page ?? 1}):`, `> ${quote.replace(/\n+/g, '\n> ')}`, question.length > 0 ? `My question: ${question}` : ''].join('\n')

  const lines = zh
    ? [
        `请协助我理解论文《${meta.title}》。`,
        '',
        `- 论文 ID：${meta.id}`,
        `- 作者：${authorsLine(meta)}`,
        `- 期刊/会议：${meta.venue || '（未知）'}`,
        `- DOI：${meta.doi || '（无）'}`,
        `- 本地目录：${paperPath}`,
        '',
        quoted,
        notesHint,
        selectionBlock,
        annotationsBlock(annotations, true),
        '',
        `任务：${task}`,
        instruction,
        '',
        '阅读顺序建议：先 `paper_info`，再 `paper_text` 读第 1 页（标题/摘要/引言），然后按需读取方法与实验所在页。普通讨论只读，不自动保存笔记，用户会在界面决定是否保存。',
        '输出要求：答案会直接显示在论文阅读器的 AI 侧栏里。请用 Markdown（标题/列表/公式），先给结论；引用原文时标注页码，格式为 p.N（如 p.3）；不要在最终答案里复述工具调用过程。',
        extra.length > 0 ? `补充要求：${extra}` : '',
      ]
    : [
        `Help me understand the paper "${meta.title}".`,
        '',
        `- Paper id: ${meta.id}`,
        `- Authors: ${authorsLine(meta)}`,
        `- Venue: ${meta.venue || '(unknown)'}`,
        `- DOI: ${meta.doi || '(none)'}`,
        `- Local directory: ${paperPath}`,
        '',
        quoted,
        notesHint,
        '',
        `Task: ${task}`,
        instruction,
        '',
        'Suggested reading order: `paper_info`, then `paper_text` for page 1, then the method and experiment pages as needed. Discussion is read-only; the user decides whether to save notes in the UI.',
        'Output: your answer is rendered in the PaperDesk AI side panel. Use Markdown (headings/lists/equations), lead with the conclusion, cite pages as p.N (e.g. p.3), and keep tool-call narration out of the final answer.',
        extra.length > 0 ? `Additional requirements: ${extra}` : '',
      ]

  return {
    workspacePath: root,
    prompt: lines.filter((line) => line !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    title: zh ? `${task} · ${meta.title}` : `${task} · ${meta.title}`,
  }
}


/**
 * Prompt for comparing 2..6 papers. The answer is rendered in the PaperDesk
 * comparison view; it asks for a comparison table, cross-paper conclusions and
 * suggested typed relations the user can accept.
 */
export function comparePrompt(papers: PaperMeta[], settings: EffectiveSettings): AssistPayload {
  const zh = isZh(settings)
  const root = settings.libraryPath
  const lines: string[] = []
  if (zh) {
    lines.push(`请对比以下 ${papers.length} 篇论文，并把答案写成一个可直接展示的对比报告：`)
  } else {
    lines.push(`Compare the following ${papers.length} papers and produce a report ready to display:`)
  }
  lines.push('')
  papers.forEach((paper, index) => {
    const authors = paper.authors.length > 0 ? paper.authors.join(', ') : zh ? '（未知作者）' : '(unknown authors)'
    const venue = paper.venue.length > 0 ? paper.venue : zh ? '（未知 venue）' : '(unknown venue)'
    lines.push(
      `${index + 1}. 《${paper.title}》 · ${authors}${paper.year === null ? '' : ` · ${paper.year}`} · ${venue}`,
    )
    lines.push(`   - id: ${paper.id}`)
    lines.push(`   - DOI: ${paper.doi || '—'} · 页数: ${paper.pageCount === null ? '?' : paper.pageCount}`)
    lines.push(`   - 目录: ${root}/papers/${paper.id}`)
    if (paper.abstract.trim().length > 0) {
      lines.push(`   - 摘要: ${paper.abstract.replace(/\s+/g, ' ').slice(0, 600)}`)
    }
  })
  lines.push('')
  lines.push(
    zh
      ? [
          '阅读方式：对每篇论文先用 `paper_info` 看元数据，再用 `paper_text` 读摘要/引言 + 方法/实验的关键页（每篇 3-6 页即可），必要时用 `paper_annotations` 看已在 PDF 上的标注；不要一次读完整篇。',
          '',
          '输出结构（Markdown）：',
          '1. **一句话结论**：这几篇论文放在一起最值得注意的 1-2 句话。',
          '2. **对比表**：表头列固定为：论文（用第一作者+年份简称）| 研究问题 | 核心方法 | 数据与实验 | 主要结果 | 局限 | 可复用点。每行一篇论文，内容简洁，关键数字标注页码 p.N。',
          '3. **横向结论**：3-6 条，说明谁在什么条件下更好、差距来自哪里、可否组合。',
          '4. **建议关联**：每行 `- [关系类型] 论文A ↔ 论文B：理由`，关系类型只能是 cites / related / method / contrast / same-topic / custom 之一；这些关联会展示给用户，等待用户确认后写入论文图谱。',
          '5. **我实际读过的页**：列出每篇读了哪些页。',
          '',
          '约束：只根据 PDF 内容与元数据作答，不编造数字；不确定的地方明确写“推断”。',
          '本次任务只读：不要调用任何写工具（包括但不限于 paper_note_append、paper_update、paper_add、paper_sync 或关系写入）；不要修改论文笔记、卡片或图谱。报告生成后由用户在界面上决定是否保存；不要在报告或工具说明里声称“已写入笔记/卡片/关系”。',
        ].join('\n')
      : [
          'Reading: for each paper use `paper_info` for metadata, then `paper_text` for abstract/intro and 3-6 key method/experiment pages; `paper_annotations` if useful. Do not read whole papers.',
          '',
          'Output structure (Markdown):',
          '1. **One-sentence takeaway.**',
          '2. **Comparison table** with columns: paper (first author + year) | problem | method | data & experiments | main results | limitations | reusable ideas. One row per paper, cite p.N for key numbers.',
          '3. **Cross-paper conclusions**: 3-6 items on which paper wins under which conditions and where the differences come from.',
          '4. **Suggested relations**: one per line `- [kind] Paper A ↔ Paper B: reason`, kind ∈ cites / related / method / contrast / same-topic / custom. The user will confirm before they are added.',
          '5. **Pages actually read.**',
          '',
          'Constraints: answer only from the PDFs/metadata; never invent numbers; mark uncertain claims as inference.',
          'This task is read-only: do not call any write tool (including paper_note_append, paper_update, paper_add, paper_sync or relation writes); leave notes, cards and the graph untouched. The user decides whether to save the report in the UI; never claim in the report or tool text that notes/cards/relations were written.',
        ].join('\n'),
  )
  const title = papers.map((paper) => shortenTitle(paper.title)).join(' vs ')
  return {
    workspacePath: root,
    prompt: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    title: zh ? `对比 · ${title}` : `Compare · ${title}`,
  }
}

function shortenTitle(title: string): string {
  const trimmed = title.trim()
  return trimmed.length > 32 ? `${trimmed.slice(0, 30)}…` : trimmed
}


/**
 * Prompt for AI relation discovery. The answer is parsed into candidate cards
 * in the relation graph; the user confirms before anything is written.
 */
export function discoverRelationsPrompt(
  papers: PaperMeta[],
  relations: RelationsDocument,
  settings: EffectiveSettings,
  scopeIds?: readonly string[],
): AssistPayload {
  const zh = isZh(settings)
  const root = settings.libraryPath
  const scope = scopeIds === undefined ? null : new Set(scopeIds)
  const listed = scope === null ? papers : papers.filter((paper) => scope.has(paper.id))
  const listedIds = new Set(listed.map((paper) => paper.id))
  const visibleRelations = scope === null
    ? relations.items
    : relations.items.filter((relation) => listedIds.has(relation.from) && listedIds.has(relation.to))
  const lines: string[] = []
  if (zh) {
    lines.push(
      scope === null
        ? `请分析论文库里的 ${listed.length} 篇论文，提出彼此之间值得建立的关联（候选）。`
        : `请分析本轮增量范围内的 ${listed.length} 篇论文（新论文 + 邻域），提出彼此之间值得建立的关联（候选）。`,
    )
  } else {
    lines.push(
      scope === null
        ? `Analyse the ${listed.length} papers in the library and propose candidate relations between them.`
        : `Analyse the ${listed.length} papers in this incremental scope (new papers + neighbours) and propose candidate relations between them.`,
    )
  }
  lines.push('')
  if (zh) lines.push('论文清单：')
  else lines.push('Papers:')
  for (const paper of listed.slice(0, 80)) {
    const authors = paper.authors.slice(0, 3).join(', ')
    const venue = paper.venue.length > 0 ? paper.venue : '—'
    lines.push(`- id: ${paper.id} · 《${paper.title}》 · ${authors}${paper.year === null ? '' : ` · ${paper.year}`} · ${venue}`)
    if (paper.abstract.trim().length > 0) {
      lines.push(`  ${zh ? '摘要' : 'Abstract'}: ${paper.abstract.replace(/\s+/g, ' ').slice(0, 400)}`)
    }
    if (paper.tags.length > 0) lines.push(`  ${zh ? '标签' : 'Tags'}: ${paper.tags.join(', ')}`)
  }
  lines.push('')
  lines.push(zh ? '已有关系（不要重复提出）：' : 'Existing relations (do not propose again):')
  if (visibleRelations.length === 0) {
    lines.push(zh ? '（暂无）' : '(none)')
  } else {
    for (const relation of visibleRelations.slice(0, 120)) {
      lines.push(`- [${relation.kind}] ${relation.from} ↔ ${relation.to}${relation.label ? ` (${relation.label})` : ''}`)
    }
  }
  lines.push('')
  if (scope !== null) {
    lines.push(
      zh
        ? '增量范围：只分析上面列出的论文及其已有关系，不要提出清单之外论文的候选；这样新论文加入时无需重复发送整张图谱。'
        : 'Incremental scope: only analyse the papers listed above and their existing relations; do not propose candidates for papers outside this scope, so a new paper never requires re-sending the whole graph.',
    )
    lines.push('')
  }
  lines.push(
    zh
      ? [
          '分析方式：优先依据标题/摘要/标签/作者/期刊；需要时用 `paper_info`、`paper_cards`、`paper_notes_read` 或 `paper_relations` 补充证据；只有确有必要时才用 `paper_text` 读少量页面（每篇不超过 3 页）。不要逐篇通读。',
          '',
          '输出结构（Markdown）：',
          '1. **分析说明**：你用哪些信息判断的（1-3 句即可）。',
          '2. **候选关联**：每行严格使用格式 `- [关系类型] 论文A ↔ 论文B：理由（证据来源）`。关系类型只能是 cites / related / method / contrast / same-topic / custom 之一；论文名用「第一作者姓 + 年份」或标题简称；理由要具体（共同方法/数据集/作者/引用关系/相反结论）。',
          '3. **信息不足**：列出无法判断或需要更多信息的论文（可为空）。',
          '',
          '要求：提出 5-15 条高置信度候选；宁可少提也不要编造；不要提出清单中不存在的论文；不要与已有关系重复。',
          '本次任务只读：不要调用任何写工具（paper_note_append、paper_update、paper_add、关系写入等）；候选只展示，由用户勾选后再写入。',
        ].join('\n')
      : [
          'How to analyse: prefer titles/abstracts/tags/authors/venue; use `paper_info`, `paper_cards`, `paper_notes_read` or `paper_relations` when useful; only read a few pages with `paper_text` when necessary (≤3 pages per paper). Do not read whole papers.',
          '',
          'Output (Markdown):',
          '1. **Basis**: 1-3 sentences on the evidence used.',
          '2. **Candidate relations**: one per line, exactly `- [kind] Paper A ↔ Paper B: reason (evidence)`. kind ∈ cites/related/method/contrast/same-topic/custom; name papers as “first-author surname + year” or a short title; make the reason concrete.',
          '3. **Insufficient information**: papers that cannot be judged (may be empty).',
          '',
          'Requirements: 5-15 high-confidence candidates; prefer fewer over invented ones; never reference papers not in the list; do not duplicate existing relations.',
          'This task is read-only: do not call any write tool (paper_note_append, paper_update, paper_add, relation writes); candidates are displayed and only written after the user selects them.',
        ].join('\n'),
  )
  return {
    workspacePath: root,
    prompt: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    title: zh ? `关系发现 · ${papers.length} 篇论文` : `Relation discovery · ${papers.length} papers`,
  }
}
