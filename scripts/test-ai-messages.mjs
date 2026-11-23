import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = await mkdtemp(path.join(os.tmpdir(), 'paperdesk-ai-messages-'))
let checks = 0
const check = (label, actual, expected) => { assert.equal(actual, expected, label); checks++; console.log(`ok ${label}`) }
try {
  const file = path.join(root, 'messages.mjs')
  await build({
    stdin: { contents: "export * from './client/ConversationMessages.tsx'; export { TopicCommentComposer } from './client/TopicComments.tsx'", resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', outfile: file,
    plugins: [{ name: 'shared-react', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path: specifier }) => ({ path: require.resolve(specifier), external: true }))
    } }],
  })
  const { UserQuestion, AssistantAnswer, TopicCommentComposer } = await import(pathToFileURL(file))
  const question = (text) => renderToStaticMarkup(createElement(UserQuestion, { text, label: '你', expand: '展开完整问题', collapse: '收起问题' }))
  const short = question('我是说新建一个卡片，保存这些内容')
  check('short question exposes the user role without a repeated heading', short.includes('aria-label="你"') && !short.includes('>你</span>'), true)
  check('short question is shown in full', short.includes('我是说新建一个卡片，保存这些内容</p>'), true)
  const longText = Array.from({ length: 15 }, (_, i) => `要求 ${i + 1}：保留引用和个人判断。`).join('\n')
  const long = question(longText)
  check('long question starts expanded with the complete text', long.includes(`data-collapsed="false">${longText}</p>`), true)
  check('injected paper context stays out of the visible question', question('Private paper context\n\n---\n\n我的问题全文').includes('Private paper context'), false)
  const typed = 'First request.\n\n---\n\nTask: this heading belongs to my question.\nSecond request.'
  const structured = renderToStaticMarkup(createElement(UserQuestion, { text: typed, cleanContext: false, label: 'User', expand: 'Expand', collapse: 'Collapse' }))
  check('an already decoded topic question preserves user separators and headings', structured.includes(typed), true)
  const answer = renderToStaticMarkup(createElement(AssistantAnswer, { text: '## 方法\n\nEuler 更新为 $x_{t+1}=x_t+h v_t$。', label: 'AI 助读', streaming: true }))
  check('assistant role is visible', answer.includes('>AI 助读</span>'), true)
  check('assistant formulas still render as MathML', answer.includes('<math'), true)
  check('streaming indicator remains available', answer.includes('pd-ai-caret'), true)
  const body = answer.slice(answer.indexOf('class="pd-ai-assistant"'))
  check('role header stays outside selectable answer content', body.includes('AI 助读'), false)
  const formula = '\\frac{a}{b}'
  const comment = { id: 'formula', quote: `$${formula}$`, formulas: [formula], section: '', comment: 'Check', version: 'current' }
  const commentView = (draft) => renderToStaticMarkup(createElement(TopicCommentComposer, { draft, version: 'current', busy: false, onChange: () => {} }))
  const editor = commentView({ message: '', comments: [], editor: comment })
  check('comment editor displays complete TeX once', editor.split(formula).length - 1, 1)
  check('queued comment does not repeat TeX already in the quotation', commentView({ message: '', comments: [comment], editor: null }).includes('<pre>'), false)
  const legacy = { ...comment, quote: 'ab' }
  check('legacy flattened formula comments retain the original TeX fallback', commentView({ message: '', comments: [], editor: legacy }).includes(`<pre>${formula}</pre>`), true)
  check('queued legacy comments retain their formula fallback', commentView({ message: '', comments: [legacy], editor: null }).includes(`<pre>${formula}</pre>`), true)
  console.log(`${checks} AI message checks passed`)
} finally { await rm(root, { recursive: true, force: true }) }
