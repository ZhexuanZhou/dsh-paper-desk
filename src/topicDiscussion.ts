/** Portable data contract for report comments and the ordinary topic composer. */
export interface ReportComment {
  id: string
  quote: string
  comment: string
  version: string
  section: string
  formulas: string[]
}
export interface TopicDiscussionDraft {
  message: string
  comments: ReportComment[]
  editor: ReportComment | null
}
export const TOPIC_QUESTION_CHAR_LIMIT = 16000
export const TOPIC_QUESTION_MARKER = '\n\n本次问题：'
/** Application-owned directive identifies older analysis turns that shared chat. */
export const TOPIC_ANALYSIS_DIRECTIVE = '请围绕预设研究问题生成专题解读：先回答各个问题，再比较证据、差异与资料缺口。区分论文结论、推断和建议，标明论文与页码。给出可行方案、适用条件和优先验证步骤。只输出报告正文，由应用保存；不要调用任何写入工具，也不要把研究问题重述成等待用户继续提问的说明。'
export function isTopicAnalysisRequest(prompt: string): boolean {
  return prompt.includes(TOPIC_QUESTION_MARKER) && prompt.endsWith(`\n\n${TOPIC_ANALYSIS_DIRECTIVE}`)
}
export function isReportComment(value: unknown): value is ReportComment {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ReportComment>
  return typeof item.id === 'string' && item.id.length <= 80 && typeof item.quote === 'string' && item.quote.trim().length > 0 && item.quote.length <= 4000 &&
    typeof item.comment === 'string' && item.comment.length <= 4000 && typeof item.version === 'string' && item.version.length <= 80 &&
    typeof item.section === 'string' && item.section.length <= 200 && Array.isArray(item.formulas) && item.formulas.every((text) => typeof text === 'string' && text.length <= 4000)
}
export function topicQuestionPayload(question: string, comments: unknown = []): string {
  if (question.length > 4000 || !Array.isArray(comments) || !comments.every(isReportComment)) throw Object.assign(new Error('提问或评论格式不正确。'), { status: 400 })
  const payload = JSON.stringify({ question, comments })
  if (payload.length > TOPIC_QUESTION_CHAR_LIMIT) throw Object.assign(new Error(`提问与评论超过 ${TOPIC_QUESTION_CHAR_LIMIT} 字符，请缩短引用或分次讨论；草稿仍保留。`), { status: 400 })
  return payload
}
/** New requests have a single JSON line; user strings cannot forge a raw line marker. */
export function readTopicQuestion(prompt: string): { question: string; comments: ReportComment[] } {
  const marker = prompt.lastIndexOf(TOPIC_QUESTION_MARKER)
  const text = marker >= 0 ? prompt.slice(marker + TOPIC_QUESTION_MARKER.length) : prompt
  try {
    const data: unknown = JSON.parse(text)
    if (data && typeof data === 'object' && 'question' in data && typeof data.question === 'string' && 'comments' in data && Array.isArray(data.comments) && data.comments.every(isReportComment)) return { question: data.question, comments: data.comments }
  } catch { /* Keep old saved conversations readable, without rewriting them. */ }
  return { question: text, comments: [] }
}
