import { useEffect } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

const visible = (element: HTMLElement): boolean => element.getClientRects().length > 0 && !element.closest('[hidden], [inert], [aria-hidden="true"]')

/** Respect overlay stacking levels; equal levels follow document order. */
export function topDialog(): HTMLElement | null {
  const layers = (dialog: HTMLElement): number[] => {
    const values: number[] = []
    for (let node: HTMLElement | null = dialog; node; node = node.parentElement) {
      const z = Number.parseInt(getComputedStyle(node).zIndex, 10)
      if (Number.isFinite(z)) values.unshift(z)
    }
    return values
  }
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter(visible).map((node) => ({ node, layers: layers(node) }))
  dialogs.sort((a, b) => {
    for (let index = 0; index < Math.max(a.layers.length, b.layers.length); index++) {
      const delta = (a.layers[index] ?? -Infinity) - (b.layers[index] ?? -Infinity)
      if (delta) return delta
    }
    return 0
  })
  return dialogs.at(-1)?.node ?? null
}

/** Keep keyboard focus in the active dialog, including nested forms in custom overlays. */
export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current
    if (!open || !root) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const origins = new Map<HTMLElement, HTMLElement | null>()
    let current: HTMLElement | null = null
    const controls = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((node) => visible(node) && (node.tabIndex >= 0 || (node.isContentEditable && !node.hasAttribute('tabindex'))))
    const focusWithin = (dialog: HTMLElement) => {
      if (dialog.contains(document.activeElement)) return
      if (dialog.hasAttribute('tabindex')) dialog.focus()
      else controls(dialog)[0]?.focus()
    }
    const update = () => {
      const dialog = topDialog()
      if (!dialog || !root.contains(dialog)) return
      if (dialog !== current) {
        const restore = current ? origins.get(current) : null
        if (current && !visible(current) && restore?.isConnected && dialog.contains(restore)) restore.focus()
        else origins.set(dialog, document.activeElement instanceof HTMLElement ? document.activeElement : null)
        current = dialog
      }
      focusWithin(dialog)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const dialog = topDialog()
      if (!dialog || !root.contains(dialog)) return
      const items = controls(dialog)
      const first = items[0]
      const last = items.at(-1)
      if (!first || !last) { event.preventDefault(); dialog.focus(); return }
      const active = document.activeElement
      if (!dialog.contains(active) || active === dialog || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', update, true)
    const observer = new MutationObserver(update)
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })
    update()
    return () => {
      observer.disconnect()
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', update, true)
      const remaining = topDialog()
      if (previous?.isConnected && (!remaining || remaining === root || remaining.contains(previous))) previous.focus()
    }
  }, [open, ref])
}
