/**
 * Configurable keyboard shortcuts for the PDF viewer.
 *
 * Bindings are stored in localStorage (a per-install preference, like the
 * existing reader width / AI zoom). The viewer reads the current map on every
 * key event so changes made in Settings apply as soon as the user returns.
 */
export type KeyAction =
  | 'scrollDown'
  | 'scrollUp'
  | 'halfPageDown'
  | 'halfPageUp'
  | 'pageNext'
  | 'pagePrev'
  | 'firstPage'
  | 'lastPage'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'visualMode'
  | 'swapSelection'
  | 'selectLeft'
  | 'selectRight'
  | 'selectLineDown'
  | 'selectLineUp'
  | 'selectWordForward'
  | 'selectWordBackward'
  | 'highlightSelection'
  | 'copySelection'
  | 'help'

export type KeyMap = Record<KeyAction, string>

export const KEYMAP_STORAGE = 'paperdesk:keymap:v1'

export const DEFAULT_KEYMAP: KeyMap = {
  scrollDown: 'j',
  scrollUp: 'k',
  halfPageDown: 'Ctrl+d',
  halfPageUp: 'Ctrl+u',
  pageNext: 'n',
  pagePrev: 'p',
  firstPage: 'g',
  lastPage: 'G',
  zoomIn: '+',
  zoomOut: '-',
  zoomReset: '0',
  visualMode: 'v',
  swapSelection: 'o',
  selectLeft: 'h',
  selectRight: 'l',
  selectLineDown: 'j',
  selectLineUp: 'k',
  selectWordForward: 'w',
  selectWordBackward: 'b',
  highlightSelection: 'y',
  copySelection: 'Y',
  help: '?',
}

export const KEY_ACTIONS: readonly KeyAction[] = [
  'scrollDown',
  'scrollUp',
  'halfPageDown',
  'halfPageUp',
  'pageNext',
  'pagePrev',
  'firstPage',
  'lastPage',
  'zoomIn',
  'zoomOut',
  'zoomReset',
  'visualMode',
  'swapSelection',
  'selectLeft',
  'selectRight',
  'selectLineDown',
  'selectLineUp',
  'selectWordForward',
  'selectWordBackward',
  'highlightSelection',
  'copySelection',
  'help',
]

export function loadKeyMap(): KeyMap {
  try {
    const raw = localStorage.getItem(KEYMAP_STORAGE)
    if (raw === null) return { ...DEFAULT_KEYMAP }
    const parsed = JSON.parse(raw) as Partial<Record<KeyAction, unknown>> | null
    const next = { ...DEFAULT_KEYMAP }
    if (parsed !== null && typeof parsed === 'object') {
      for (const action of KEY_ACTIONS) {
        const value = parsed[action]
        if (typeof value === 'string' && value.trim() !== '') next[action] = value.trim()
      }
    }
    return next
  } catch {
    return { ...DEFAULT_KEYMAP }
  }
}

export function saveKeyMap(map: KeyMap): void {
  try {
    localStorage.setItem(KEYMAP_STORAGE, JSON.stringify(map))
  } catch {
    // Preferences are best-effort.
  }
}

/** Human-readable label for a KeyboardEvent, e.g. "Ctrl+d", "G", "?". */
export function formatKeyBinding(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  if (event.key === 'Control' || event.key === 'Meta' || event.key === 'Alt' || event.key === 'Shift') return ''
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.metaKey) parts.push('Meta')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey && event.key.length > 1) parts.push('Shift')
  let key = event.key
  if (event.shiftKey && key.length === 1) key = key.toUpperCase()
  if (key === ' ') key = 'Space'
  parts.push(key)
  return parts.join('+')
}

/** Does this key event match a stored binding? */
export function matchesBinding(event: KeyboardEvent, binding: string): boolean {
  const expected = binding.trim()
  if (expected === '') return false
  if (expected === 'Space') return event.key === ' '
  const plus = expected.lastIndexOf('+')
  if (plus < 0) {
    // Bare key: modifiers must not be involved. Letter case matters so that
    // the Vim defaults g (first page) and G (last page) stay distinct.
    if (event.ctrlKey || event.metaKey || event.altKey) return false
    return event.key === expected
  }
  const mods = expected.slice(0, plus).split('+').map((part) => part.trim().toLowerCase())
  const key = expected.slice(plus + 1)
  if (event.ctrlKey !== mods.includes('ctrl')) return false
  if (event.metaKey !== mods.includes('meta')) return false
  if (event.altKey !== mods.includes('alt')) return false
  const wantsShift = mods.includes('shift')
  if (event.shiftKey !== wantsShift && key.length > 1) return false
  return event.key.toLowerCase() === key.toLowerCase()
}

export const KEY_ACTION_LABELS: Record<KeyAction, { zh: string; en: string }> = {
  scrollDown: { zh: '向下滚动', en: 'Scroll down' },
  scrollUp: { zh: '向上滚动', en: 'Scroll up' },
  halfPageDown: { zh: '向下半页', en: 'Half page down' },
  halfPageUp: { zh: '向上半页', en: 'Half page up' },
  pageNext: { zh: '下一页', en: 'Next page' },
  pagePrev: { zh: '上一页', en: 'Previous page' },
  firstPage: { zh: '第一页', en: 'First page' },
  lastPage: { zh: '最后一页', en: 'Last page' },
  zoomIn: { zh: '放大', en: 'Zoom in' },
  zoomOut: { zh: '缩小', en: 'Zoom out' },
  zoomReset: { zh: '实际大小', en: 'Actual size' },
  visualMode: { zh: '进入/退出可视选择', en: 'Visual mode' },
  swapSelection: { zh: '交换选区两端', en: 'Swap selection ends' },
  selectLeft: { zh: '选择：向左一个字符', en: 'Select: char left' },
  selectRight: { zh: '选择：向右一个字符', en: 'Select: char right' },
  selectLineDown: { zh: '选择：向下一行', en: 'Select: line down' },
  selectLineUp: { zh: '选择：向上一行', en: 'Select: line up' },
  selectWordForward: { zh: '选择：下一个词', en: 'Select: next word' },
  selectWordBackward: { zh: '选择：上一个词', en: 'Select: previous word' },
  highlightSelection: { zh: '高亮选中内容', en: 'Highlight selection' },
  copySelection: { zh: '复制选中文本', en: 'Copy selection' },
  help: { zh: '快捷键帮助', en: 'Shortcut help' },
}
