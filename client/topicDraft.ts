import { isReportComment } from '../src/topicDiscussion.js'
import type { TopicDiscussionDraft } from '../src/topicDiscussion.js'
export const emptyTopicDraft = (): TopicDiscussionDraft => ({ message: '', comments: [], editor: null })
const memoryDrafts = new Map<string, TopicDiscussionDraft>()
const unsavedDrafts = new Set<string>()
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export function topicDraftKey(workspace: string, topicId: string): string { return `paperdesk:topic-draft:${workspace}:${topicId}` }
export function readTopicDraft(store: Store | null, key: string): TopicDiscussionDraft {
  if (unsavedDrafts.has(key) && memoryDrafts.has(key)) return memoryDrafts.get(key)!
  try {
    const value: unknown = JSON.parse(store?.getItem(key) ?? 'null')
    if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' && 'comments' in value && Array.isArray(value.comments) && value.comments.every(isReportComment)) {
      return { message: value.message, comments: value.comments, editor: 'editor' in value && isReportComment(value.editor) ? value.editor : null }
    }
  } catch { /* A malformed draft does not block the workspace. */ }
  return memoryDrafts.get(key) ?? emptyTopicDraft()
}
export function writeTopicDraft(store: Store | null, key: string, value: TopicDiscussionDraft): boolean {
  memoryDrafts.set(key, value)
  if (!store) { unsavedDrafts.add(key); return false }
  try {
    if (!value.message && !value.comments.length && !value.editor) store.removeItem(key)
    else store.setItem(key, JSON.stringify(value))
    unsavedDrafts.delete(key)
    return true
  } catch { unsavedDrafts.add(key); return false }
}
export function clearSubmittedTopicDraft(current: TopicDiscussionDraft, sent: TopicDiscussionDraft): TopicDiscussionDraft {
  return { ...current, message: current.message === sent.message ? '' : current.message,
    comments: current.comments.filter((comment) => !sent.comments.some((old) => old.id === comment.id && JSON.stringify(old) === JSON.stringify(comment))) }
}
export function browserDraftStore(): Store | null { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
