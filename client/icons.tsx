/**
 * PaperDesk icons: 16px, 1.6 stroke, `currentColor`, no external icon package.
 *
 * The shell styles `svg` descendants aggressively (a fill on an ancestor would
 * otherwise turn a stroke glyph into a solid blob), so every icon sets
 * `fill="none"` AND an inline `style.fill = 'none'` on the `<svg>` and on every
 * shape — inline styles win over the shell's stylesheet. `PanelIcon` is the
 * sidebar panellist mark, drawn at 18px / 1.3 stroke to match the shell's
 * Plugins / Automation / Context Insights line-art glyphs.
 */
import type { SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number
}

/** Inline style (not just the attribute) so ancestor CSS cannot fill shapes. */
const NO_FILL = { fill: 'none' } as const

function mergeStyle(style: SVGProps<SVGElement>['style']): SVGProps<SVGElement>['style'] {
  return style === undefined ? NO_FILL : { ...style, fill: 'none' }
}

function base(props: IconProps, size: number): SVGProps<SVGSVGElement> {
  const { size: _size, style, ...rest } = props
  void _size
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    style: mergeStyle(style),
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
    ...rest,
  }
}

/* Shape helpers: guarantee `fill="none"` + inline fill:none on every element. */
function P(props: SVGProps<SVGPathElement>) {
  return <path {...props} fill="none" style={mergeStyle(props.style)} />
}

function C(props: SVGProps<SVGCircleElement>) {
  return <circle {...props} fill="none" style={mergeStyle(props.style)} />
}

function R(props: SVGProps<SVGRectElement>) {
  return <rect {...props} fill="none" style={mergeStyle(props.style)} />
}

/** Sidebar panellist mark: an open book (thin line art, matches shell glyphs). */
export function PanelIcon(props: IconProps) {
  const size = props.size ?? 18
  return (
    <svg {...base(props, size)} strokeWidth={1.3}>
      <P d="M8 4.35C6.8 3.42 5.28 2.95 3.62 2.95c-.43 0-.84.04-1.22.11v9.2c.38-.07.79-.11 1.22-.11 1.66 0 3.18.47 4.38 1.4 1.2-.93 2.72-1.4 4.38-1.4.43 0 .84.04 1.22.11v-9.2a6.9 6.9 0 0 0-1.22-.11C9.72 2.95 8.2 3.42 8 4.35Z" />
      <P d="M8 4.35v9.2" />
    </svg>
  )
}

export function IconImport(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M8 2.2v7.2" />
      <P d="m5.1 6.8 2.9 2.6 2.9-2.6" />
      <P d="M2.4 10.6v1.7c0 .8.6 1.5 1.4 1.5h8.4c.8 0 1.4-.7 1.4-1.5v-1.7" />
    </svg>
  )
}

export function IconSync(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M13.4 7.2A5.5 5.5 0 0 0 3.5 4.5L2.2 5.8" />
      <P d="M2.2 2.9v2.9h2.9" />
      <P d="M2.6 8.8a5.5 5.5 0 0 0 9.9 2.7l1.3-1.3" />
      <P d="M13.8 13.1v-2.9h-2.9" />
    </svg>
  )
}

export function IconGear(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <C cx="8" cy="8" r="2.1" />
      <P d="M8 1.9v1.5M8 12.6v1.5M1.9 8h1.5M12.6 8h1.5M3.7 3.7l1.1 1.1M11.2 11.2l1.1 1.1M12.3 3.7l-1.1 1.1M4.8 11.2l-1.1 1.1" />
    </svg>
  )
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <C cx="7.1" cy="7.1" r="4.3" />
      <P d="m10.4 10.4 3 3" />
    </svg>
  )
}

export function IconSpark(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M8 1.8 9.4 5l3.2 1.4L9.4 7.8 8 11 6.6 7.8 3.4 6.4 6.6 5Z" />
      <P d="M12.4 10.7l.7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7Z" />
    </svg>
  )
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M2.7 4.2h10.6" />
      <P d="M6.2 4.2V2.8c0-.4.3-.7.7-.7h2.2c.4 0 .7.3.7.7v1.4" />
      <P d="M4.1 4.2v8.6c0 .8.6 1.4 1.4 1.4h5c.8 0 1.4-.6 1.4-1.4V4.2" />
      <P d="M6.6 6.9v4.4M9.4 6.9v4.4" />
    </svg>
  )
}

export function IconEdit(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M9.6 2.8 13.2 6.4 5.9 13.7l-3.8.9.9-3.8Z" />
      <P d="m8.2 4.2 3.6 3.6" />
    </svg>
  )
}

export function IconBook(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M8 3.6C6.7 2.5 5 2 3.1 2c-.4 0-.8 0-1.1.1v10.3c.3-.1.7-.1 1.1-.1 1.9 0 3.6.5 4.9 1.6 1.3-1.1 3-1.6 4.9-1.6.4 0 .8 0 1.1.1V2.1c-.3-.1-.7-.1-1.1-.1C11 2 9.3 2.5 8 3.6Z" />
      <P d="M8 3.6v10.3" />
    </svg>
  )
}

export function IconNote(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M3.2 2.4h9.6c.4 0 .8.3.8.8v9.6c0 .4-.4.8-.8.8H3.2a.8.8 0 0 1-.8-.8V3.2c0-.5.4-.8.8-.8Z" />
      <P d="M5 5.6h6M5 8h6M5 10.4h3.6" />
    </svg>
  )
}

export function IconFolder(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M2 4.4c0-.5.4-.9.9-.9h3l1.4 1.5h5.8c.5 0 .9.4.9.9v6.4c0 .5-.4.9-.9.9H2.9a.9.9 0 0 1-.9-.9Z" />
    </svg>
  )
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M13.1 8a5.1 5.1 0 1 1-1.6-3.7" />
      <P d="M13.5 2.3v3.2h-3.2" />
    </svg>
  )
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="m3.8 3.8 8.4 8.4M12.2 3.8l-8.4 8.4" />
    </svg>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="m3 8.4 3.2 3.2L13 4.8" />
    </svg>
  )
}

export function IconWarning(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M8 2.2 14.2 13H1.8Z" />
      <P d="M8 6.1v3.3M8 11.4v.1" />
    </svg>
  )
}

export function IconInfo(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <C cx="8" cy="8" r="6" />
      <P d="M8 7.2v3.6M8 5.2v.1" />
    </svg>
  )
}

export function IconDownload(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M8 2.4v7.2" />
      <P d="m4.9 6.7 3.1 2.9 3.1-2.9" />
      <P d="M2.6 12.9h10.8" />
    </svg>
  )
}

export function IconQuote(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M6.4 3.8C4.2 4.8 3 6.6 3 9.1v3.1h4.2V8.1H5.1c0-1.4.5-2.4 1.9-3.1Z" />
      <P d="M13.1 3.8C11 4.8 9.8 6.6 9.8 9.1v3.1H14V8.1h-2.1c0-1.4.5-2.4 1.9-3.1Z" />
    </svg>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M8 3v10M3 8h10" />
    </svg>
  )
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <R x="5.6" y="5.6" width="8" height="8" rx="1.3" />
      <P d="M10.4 5.6v-1c0-.7-.6-1.3-1.3-1.3H3.9c-.7 0-1.3.6-1.3 1.3v5.2c0 .7.6 1.3 1.3 1.3h1" />
    </svg>
  )
}

export function IconLang(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M2.2 3.6h6.4M5.4 2.2v1.4M7.3 3.6c-.3 2.8-1.7 5.1-4.3 6.5M4 6.3c.6 1.6 1.7 2.8 3.4 3.5" />
      <P d="m9.2 13.4 2.3-6 2.3 6M9.9 11.5h3.2" />
    </svg>
  )
}

export function IconExternal(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M9.2 2.6h4.2v4.2" />
      <P d="m13.4 2.6-5.7 5.7" />
      <P d="M12.2 9.5v2.7c0 .7-.6 1.2-1.2 1.2H3.8c-.7 0-1.2-.6-1.2-1.2V5c0-.7.6-1.2 1.2-1.2h2.7" />
    </svg>
  )
}

export function IconSave(props: IconProps) {
  return (
    <svg {...base(props, 16)}>
      <P d="M3.2 2.6h7.6l2.2 2.2v8c0 .4-.3.6-.6.6H3.2a.6.6 0 0 1-.6-.6V3.2c0-.4.2-.6.6-.6Z" />
      <P d="M5.2 2.6v3.2h5V2.6M5.2 13.4V9.2h5.6v4.2" />
    </svg>
  )
}

/** Horizontal overflow (⋯) — three round dots drawn with round stroke caps. */
export function IconMore(props: IconProps) {
  return (
    <svg {...base(props, 16)} strokeWidth={2.4}>
      <P d="M3.6 8h.01M8 8h.01M12.4 8h.01" />
    </svg>
  )
}

/** Small filled dot used by status/legend UI (intentionally solid). */
export function IconDot(props: IconProps) {
  return (
    <svg {...base(props, 16)} strokeWidth={0}>
      <circle cx="8" cy="8" r="4" fill="currentColor" />
    </svg>
  )
}
