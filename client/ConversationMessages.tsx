import { useId, useLayoutEffect, useRef, useState } from 'react'
import { cleanUserPrompt } from './chatText.js'
import { IconSpark } from './icons.js'
import { Markdown } from './markdown.js'

/** Keep the actual question readable; folding is optional and based on rendered lines. */
export function UserQuestion({ text, label, expand, collapse }: {
  text: string; label: string; expand: string; collapse: string
}) {
  const body = cleanUserPrompt(text)
  const bodyId = useId()
  const bodyRef = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(true)
  const [canCollapse, setCanCollapse] = useState(false)

  useLayoutEffect(() => {
    setExpanded(true)
    const node = bodyRef.current
    if (!node) return
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight)
      const long = Number.isFinite(lineHeight) && node.scrollHeight > lineHeight * 8 + 1
      setCanCollapse(long)
      // A wider panel may no longer need folding; never leave text clipped without its toggle.
      if (!long) setExpanded(true)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [body])

  return <div className="pd-ai-user" role="group" aria-label={label}>
    <p ref={bodyRef} id={bodyId} className="pd-ai-question-text" data-collapsed={!expanded}>{body}</p>
    {canCollapse ? <button type="button" className="pd-ai-question-toggle"
      aria-expanded={expanded} aria-controls={bodyId}
      onClick={() => setExpanded((value) => !value)}>{expanded ? collapse : expand}</button> : null}
  </div>
}

export function AssistantIdentity({ label }: { label: string }) {
  return <div className="pd-ai-message-head pd-ai-answer-head">
    <IconSpark size={14} />
    <span className="pd-ai-message-role">{label}</span>
  </div>
}

export function AssistantAnswer({ text, label, streaming = false }: {
  text: string; label?: string; streaming?: boolean
}) {
  return <>
    {label ? <AssistantIdentity label={label} /> : null}
    <div className="pd-ai-assistant">
      <Markdown markdown={text} />
      {streaming ? <span className="pd-ai-caret" aria-hidden="true" /> : null}
    </div>
  </>
}
