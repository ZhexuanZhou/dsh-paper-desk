export interface TopicLayoutSettings { listWidth: number; chatWidth: number; listClosed: boolean; chatClosed: boolean }
export const DEFAULT_TOPIC_LAYOUT: TopicLayoutSettings = { listWidth: 216, chatWidth: 400, listClosed: false, chatClosed: false }
export type TopicSide = 'list' | 'chat'
export function topicWidthRange(side: TopicSide, available: number, otherWidth: number): { min: number; max: number } {
  const min = side === 'list' ? 180 : 300, cap = side === 'list' ? 340 : 640
  return { min, max: Math.max(min, Math.min(cap, available - otherWidth - 480 - 48)) }
}
export function clampTopicWidth(value: number, side: TopicSide, available: number, otherWidth: number): number {
  const range = topicWidthRange(side, available, otherWidth)
  return Math.min(range.max, Math.max(range.min, value))
}
export function readTopicLayout(store: Pick<Storage, 'getItem'> | null): TopicLayoutSettings {
  try {
    const data = JSON.parse(store?.getItem('paperdesk:topic-layout') ?? 'null')
    if (data && Number.isFinite(data.listWidth) && Number.isFinite(data.chatWidth)) return {
      listWidth: Math.min(340, Math.max(180, data.listWidth)), chatWidth: Math.min(640, Math.max(300, data.chatWidth)),
      listClosed: data.listClosed === true, chatClosed: data.chatClosed === true,
    }
  } catch { /* Defaults remain usable when storage is unavailable. */ }
  return { ...DEFAULT_TOPIC_LAYOUT }
}
