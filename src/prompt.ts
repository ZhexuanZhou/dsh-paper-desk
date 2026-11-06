/**
 * Prompt construction: the system-prompt section that teaches every agent about
 * the library, and the ready-to-send prompts behind the reader's assist bar.
 */
import type {
  AnnotationDocument,
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
      '- 有价值的结论用 `paper_note_append` 追加到对应论文的笔记里（section 可选 summary/points/questions/quotes/thoughts），并在回复中说明已记录。',
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
    '- Persist valuable conclusions with `paper_note_append` (sections: summary/points/questions/quotes/thoughts) and say so in the reply.',
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
        '阅读顺序建议：先 `paper_info`，再 `paper_text` 读第 1 页（标题/摘要/引言），然后按需读取方法与实验所在页。需要时可以再用 `paper_note_append` 把结论写回笔记。',
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
        'Suggested reading order: `paper_info`, then `paper_text` for page 1 (title/abstract/intro), then the method and experiment pages as needed. Use `paper_note_append` to persist conclusions.',
        'Output: your answer is rendered in the PaperDesk AI side panel. Use Markdown (headings/lists/equations), lead with the conclusion, cite pages as p.N (e.g. p.3), and keep tool-call narration out of the final answer.',
        extra.length > 0 ? `Additional requirements: ${extra}` : '',
      ]

  return {
    workspacePath: root,
    prompt: lines.filter((line) => line !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    title: zh ? `${task} · ${meta.title}` : `${task} · ${meta.title}`,
  }
}
