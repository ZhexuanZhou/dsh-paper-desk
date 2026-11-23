import { useEffect, useRef, useState } from 'react'
import type { AiThreadState } from './aiSession.js'
import { groupConversationTurns } from './aiDisplay.js'
import { topicMutations, turnAnswers } from './topicConversationModel.js'
import { isTopicAnalysisRequest, readTopicQuestion } from '../src/topicDiscussion.js'
import { AssistantAnswer, UserQuestion } from './ConversationMessages.js'
import { Button } from './ui.js'
import { useT } from './i18n.js'

export function TopicConversation({ state, topicId, onViewDocument, onError, reproduction }: {
  state: AiThreadState; topicId: string; onViewDocument: (kind: 'analysis' | 'notes' | 'cards') => void; onError: (error: unknown) => void
  reproduction?: { paperId: string; threadKey: string; onViewDocument: () => void }
}) {
  const t = useT(), scrollRef = useRef<HTMLDivElement>(null), followRef = useRef(true)
  const [follow, setFollow] = useState(true), [older, setOlder] = useState(false)
  const turns = groupConversationTurns(state.threadKey === (reproduction?.threadKey ?? topicId) ? state.rows : [])
  const visible = older ? turns : turns.slice(-3)
  const [ready, setReady] = useState(false)
  useEffect(() => { followRef.current = true; setFollow(true); setOlder(false); setReady(false) }, [topicId])
  useEffect(() => {
    if (!followRef.current || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    setReady(true)
  }, [state.rows, topicId])
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text) } catch (error) { onError(error) } }
  return <div className="pd-topic-chat-wrap"><div ref={scrollRef} className="pd-topic-chat" role="log" aria-label={t('research.discussionHistory')} onScroll={(event) => {
    const element = event.currentTarget, near = element.scrollHeight - element.scrollTop - element.clientHeight < 48
    followRef.current = near; setFollow(near)
  }}>
    {!older && turns.length > 3 ? <Button size="sm" variant="ghost" onClick={() => { followRef.current = false; setOlder(true) }}>{t('research.earlierDiscussion', { n: turns.length - 3 })}</Button> : null}
    {!turns.length && state.status !== 'attaching' ? <div className="pd-topic-chat-empty"><strong>{t('research.discussionReady')}</strong><p>{t('research.discussionReadyHint')}</p></div> : null}
    {visible.map((turn) => {
      const changes = topicMutations(turn.rows, topicId), answers = turnAnswers(turn)
      const reproductionChange = reproduction ? turn.rows.map((row) => row.reproductionMutation).filter((change) => change?.paperId === reproduction.paperId).at(-1) : null
      if (turn.question && isTopicAnalysisRequest(turn.question.text)) return <div className="pd-ai-turn" key={turn.id}><div className="pd-topic-receipts"><div><strong>{t('research.initialAnalysisRecord')}</strong><Button size="sm" variant="ghost" onClick={() => onViewDocument('analysis')}>{t('research.viewDocument')}</Button></div></div><details className="pd-topic-original-reply"><summary>{t('research.originalReply')}</summary><UserQuestion text={turn.question.text} cleanContext={false} label={t('ai.you')} expand={t('ai.expandQuestion')} collapse={t('ai.collapseQuestion')} /><AssistantAnswer text={answers} /><Button size="sm" variant="ghost" onClick={() => void copy(answers)}>{t('ai.copyMarkdown')}</Button></details></div>
      const request = turn.question ? readTopicQuestion(turn.question.text) : null
      return <div className="pd-ai-turn" key={turn.id}>{request ? <><UserQuestion text={request.question} cleanContext={false} label={t('ai.you')} expand={t('ai.expandQuestion')} collapse={t('ai.collapseQuestion')} />{request.comments.length ? <details className="pd-topic-sent-comments"><summary>{t('research.sentComments', { n: request.comments.length })}</summary>{request.comments.map((comment) => <div key={comment.id}><blockquote>{comment.quote}</blockquote><p>{comment.comment}</p></div>)}</details> : null}</> : null}
        {reproductionChange ? <><div className="pd-topic-receipts"><div><strong>{t('reproduction.updated')}</strong>{reproductionChange.summary ? <p>{reproductionChange.summary}</p> : null}<Button size="sm" variant="ghost" onClick={reproduction?.onViewDocument}>{t('research.viewDocument')}</Button></div></div>{answers ? <details className="pd-topic-original-reply"><summary>{t('research.originalReply')}</summary><AssistantAnswer text={answers} /><Button size="sm" variant="ghost" onClick={() => void copy(answers)}>{t('ai.copyMarkdown')}</Button></details> : null}</> : changes.length ? <><div className="pd-topic-receipts">{changes.map((change) => <div key={change.document}><strong>{t(change.document === 'analysis' ? 'research.analysisUpdated' : change.document === 'notes' ? 'research.notesUpdated' : 'research.cardsUpdated')}</strong>{change.summary ? <p>{change.summary}</p> : null}<Button size="sm" variant="ghost" onClick={() => onViewDocument(change.document)}>{t('research.viewDocument')}</Button></div>)}</div>{answers ? <details className="pd-topic-original-reply"><summary>{t('research.originalReply')}</summary><AssistantAnswer text={answers} /><Button size="sm" variant="ghost" onClick={() => void copy(answers)}>{t('ai.copyMarkdown')}</Button></details> : null}</> : <>{turn.rows.filter((row) => row.kind === 'assistant').map((row) => <AssistantAnswer key={row.id} text={row.text} streaming={row.streaming} />)}{answers && !turn.rows.some((row) => row.streaming) ? <Button size="sm" variant="ghost" onClick={() => void copy(answers)}>{t('ai.copyMarkdown')}</Button> : null}</>}
        {turn.rows.filter((row) => row.kind === 'error').map((row) => <p key={row.id} className="pd-field-error" role="alert">{row.text}</p>)}
        {turn.rows.some((row) => row.kind === 'tool' || row.kind === 'reasoning') ? <details className="pd-topic-process"><summary>{t('research.process')}</summary>{turn.rows.filter((row) => row.kind === 'tool').map((row) => <p key={row.id}>{row.tool}{row.running ? ` · ${t('research.working')}` : ''}</p>)}</details> : null}
      </div>
    })}
    {state.status === 'running' ? <p role="status" className="pd-field-hint">{t('research.working')}</p> : null}
  </div>{!follow && ready && turns.length ? <Button className="pd-topic-latest" size="sm" onClick={() => { followRef.current = true; setFollow(true); if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }}>{t('research.latest')}</Button> : null}</div>
}
