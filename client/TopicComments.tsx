import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { ReportComment, TopicDiscussionDraft } from '../src/topicDiscussion.js'
import { Button } from './ui.js'
import { useT } from './i18n.js'
import { topDialog } from './dialogFocus.js'

export interface ReportSelection { quote: string; section: string; formulas: string[] }
// Older comments may have lost MathML in their quote. Keep that fallback, but
// do not print a second copy when the complete TeX is already in the quote.
const additionalFormulas = (item: ReportComment) => item.formulas.filter((formula) => !item.quote.includes(formula))
export function useReportSelection(ref: RefObject<HTMLDivElement | null>, version: string): ReportSelection | null {
  const [value, setValue] = useState<ReportSelection | null>(null)
  useEffect(() => {
    setValue(null)
    const capture = () => {
      const selection = window.getSelection(), root = ref.current
      if (topDialog() || !root || !selection || selection.isCollapsed || !selection.rangeCount) { setValue(null); return }
      const range = selection.getRangeAt(0)
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) { setValue(null); return }
      const selector = '.pd-math-inline, .pd-math-block, .katex'
      const formulaNodes = Array.from(root.querySelectorAll(selector)).filter((math) => !math.parentElement?.closest(selector) && range.intersectsNode(math))
      // A native MathML selection may begin inside the numerator and end in
      // the denominator. cloneContents() alone omits the wrapper/annotation.
      // Keep the complete source formula as context instead of flattening a/b to ab.
      const quotedRange = range.cloneRange()
      for (const math of formulaNodes) {
        if (math.contains(range.startContainer)) quotedRange.setStartBefore(math)
        if (math.contains(range.endContainer)) quotedRange.setEndAfter(math)
      }
      const fragment = quotedRange.cloneContents()
      for (const math of fragment.querySelectorAll(selector)) {
        const tex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent
        if (tex) math.replaceWith(document.createTextNode(`$${tex}$`))
      }
      const quote = (fragment.textContent ?? selection.toString()).trim()
      if (!quote) { setValue(null); return }
      const formulas: string[] = []
      for (const math of formulaNodes) {
        const tex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent
        if (tex && !formulas.includes(tex)) formulas.push(tex)
      }
      let section = ''
      for (const heading of root.querySelectorAll('h1,h2,h3')) {
        if (heading.contains(range.startContainer) || heading.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) section = heading.textContent?.trim().slice(0, 200) ?? ''
      }
      setValue((previous) => previous?.quote === quote && previous.section === section && JSON.stringify(previous.formulas) === JSON.stringify(formulas) ? previous : { quote, section, formulas })
    }
    document.addEventListener('selectionchange', capture)
    return () => document.removeEventListener('selectionchange', capture)
  }, [ref, version])
  return value
}
export function TopicCommentComposer({ draft, version, busy, onChange }: {
  draft: TopicDiscussionDraft; version: string; busy: boolean; onChange: (change: (current: TopicDiscussionDraft) => TopicDiscussionDraft) => void
}) {
  const t = useT(), editor = draft.editor
  const old = (item: ReportComment) => item.version !== version
  return <>
    {draft.comments.length ? <div className="pd-topic-comment-queue"><header><strong>{t('research.attachedComments', { n: draft.comments.length })}</strong><span>{t('research.commentsHint')}</span></header>
      {draft.comments.map((item, index) => <div key={item.id} className="pd-topic-comment-item"><details><summary><span>{index + 1}. {item.comment || item.quote}</span>{old(item) ? <small>{t('research.previousReport')}</small> : null}</summary><blockquote>{item.quote}</blockquote>{additionalFormulas(item).map((formula) => <pre key={formula}>{formula}</pre>)}<p>{item.comment}</p></details><div><Button size="sm" variant="ghost" disabled={busy || Boolean(editor)} onClick={() => onChange((value) => ({ ...value, editor: { ...item } }))}>{t('common.edit')}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange((value) => ({ ...value, comments: value.comments.filter((comment) => comment.id !== item.id), editor: value.editor?.id === item.id ? null : value.editor }))}>{t('research.removeComment')}</Button></div></div>)}
    </div> : null}
    {editor ? <section className="pd-topic-comment-editor" aria-label={t('research.commentEditor')}><header><strong>{t('research.commentEditor')}</strong>{old(editor) ? <small>{t('research.previousReport')}</small> : null}</header><details open><summary>{editor.section || t('research.commentSource')}</summary><blockquote>{editor.quote}</blockquote>{additionalFormulas(editor).map((formula) => <pre key={formula}>{formula}</pre>)}</details><label>{t('research.commentLabel')}<textarea autoFocus className="pd-textarea" maxLength={4000} aria-label={t('research.commentLabel')} placeholder={t('research.commentPlaceholder')} value={editor.comment} onChange={(event) => { const comment = event.target.value; onChange((value) => ({ ...value, editor: value.editor ? { ...value.editor, comment } : null })) }} /></label><div className="pd-research-actions"><Button size="sm" disabled={busy} onClick={() => onChange((value) => ({ ...value, editor: null }))}>{t('common.cancel')}</Button><Button size="sm" variant="primary" disabled={busy} onClick={() => onChange((value) => value.editor ? { ...value, comments: value.comments.some((item) => item.id === value.editor!.id) ? value.comments.map((item) => item.id === value.editor!.id ? value.editor! : item) : [...value.comments, value.editor], editor: null } : value)}>{t('research.completeComment')}</Button></div></section> : null}
  </>
}
