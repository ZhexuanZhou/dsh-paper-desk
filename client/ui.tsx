/**
 * Small presentational primitives for the PaperDesk panel. Everything here is
 * style-only and controlled: no data fetching, no plugin-service access.
 */
import { useEffect, useRef, useState } from 'react'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  KeyboardEventHandler,
  ReactNode,
} from 'react'
import { IconCheck, IconClose, IconInfo, IconMore, IconWarning } from './icons.js'
import { useT } from './i18n.js'

function classes(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ')
}

/* ── spinner ───────────────────────────────────────────────────────────── */

export interface SpinnerProps {
  size?: number
  label?: string
}

export function Spinner({ size = 14, label }: SpinnerProps) {
  return (
    <span className="pd-spinner" role="status" aria-label={label ?? ''} style={{ width: size, height: size }} />
  )
}

/* ── buttons ───────────────────────────────────────────────────────────── */

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  loading?: boolean
  icon?: ReactNode
  type?: 'button' | 'submit' | 'reset'
}

export function Button({
  variant = 'default',
  size = 'md',
  loading = false,
  icon,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={classes('pd-btn', `pd-btn-${variant}`, size === 'sm' && 'pd-btn-sm', className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <Spinner size={12} /> : icon}
      {children !== undefined && children !== null ? <span className="pd-btn-label">{children}</span> : null}
    </button>
  )
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Accessible label (localized by the caller). */
  label: string
  active?: boolean
}

export function IconButton({ label, active = false, children, className, ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      className={classes('pd-btn', 'pd-btn-icon', className)}
      data-active={active ? 'true' : 'false'}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

/* ── form fields ───────────────────────────────────────────────────────── */

export interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  htmlFor?: string
  children: ReactNode
  className?: string
}

export function Field({ label, hint, error, htmlFor, children, className }: FieldProps) {
  return (
    <div className={classes('pd-field', className)}>
      {label !== undefined && label !== null ? (
        <label className="pd-field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {error !== undefined && error !== null && error !== '' ? (
        <span className="pd-field-error" role="alert">
          {error}
        </span>
      ) : null}
      {hint !== undefined && hint !== null && hint !== '' ? <span className="pd-field-hint">{hint}</span> : null}
    </div>
  )
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export function TextInput({ className, invalid = false, ...rest }: TextInputProps) {
  return <input {...rest} className={classes('pd-input', className)} aria-invalid={invalid || undefined} />
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  ariaLabel?: string
  title?: string
  className?: string
  small?: boolean
}

export function Select({ value, options, onChange, disabled, ariaLabel, title, className, small = false }: SelectProps) {
  return (
    <select
      className={classes('pd-select', small && 'pd-select-sm', className)}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export interface TextareaProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  disabled?: boolean
  readOnly?: boolean
  ariaLabel?: string
  className?: string
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>
}

export function Textarea({
  value,
  onChange,
  placeholder,
  rows,
  disabled,
  readOnly,
  ariaLabel,
  className,
  onKeyDown,
}: TextareaProps) {
  return (
    <textarea
      className={classes('pd-textarea', className)}
      value={value}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readOnly}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  )
}

export interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
}

export function Checkbox({ checked, onChange, label, hint, disabled }: CheckboxProps) {
  return (
    <label className="pd-check">
      <input
        className="pd-check-input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="pd-check-text">
        <span className="pd-check-label">{label}</span>
        {hint !== undefined && hint !== null && hint !== '' ? <span className="pd-check-hint">{hint}</span> : null}
      </span>
    </label>
  )
}

/* ── chips / tabs / rating ─────────────────────────────────────────────── */

export interface ChipProps {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  title?: string
  tone?: 'neutral' | 'warn'
  className?: string
}

export function Chip({ children, active = false, onClick, title, tone = 'neutral', className }: ChipProps) {
  if (onClick === undefined) {
    return (
      <span className={classes('pd-chip', 'pd-chip-static', className)} title={title} data-tone={tone}>
        {children}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={classes('pd-chip', className)}
      data-on={active ? 'true' : 'false'}
      data-tone={tone}
      title={title}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}

export interface TabItem {
  id: string
  label: string
  icon?: ReactNode
  badge?: string | number
}

export interface TabsProps {
  tabs: readonly TabItem[]
  value: string
  onChange: (id: string) => void
  ariaLabel?: string
  className?: string
}

export function Tabs({ tabs, value, onChange, ariaLabel, className }: TabsProps) {
  return (
    <div className={classes('pd-tabs', className)} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`pd-tab-${tab.id}`}
          className="pd-tab"
          data-on={tab.id === value ? 'true' : 'false'}
          aria-selected={tab.id === value}
          onClick={() => onChange(tab.id)}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.badge !== undefined ? <span className="pd-tab-badge">{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  )
}

/* ── overflow menu ─────────────────────────────────────────────────────── */

export interface MenuItemDef {
  id: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export interface MenuProps {
  /** Accessible label of the trigger, also used as the menu label. */
  label: string
  items: readonly MenuItemDef[]
  icon?: ReactNode
  disabled?: boolean
  className?: string
  /** A visible text trigger when an icon alone would hide the action. */
  triggerLabel?: string
}

/** One icon-only trigger with a keyboard/click-away-dismissed item menu. */
export function Menu({ label, items, icon, disabled = false, className, triggerLabel }: MenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current !== null && rootRef.current.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <span className={classes('pd-menu', className)} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerLabel ? 'pd-btn pd-btn-sm' : 'pd-btn pd-btn-icon'}
        data-active={open ? 'true' : 'false'}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((previous) => !previous)}
      >
        {triggerLabel ? <span>{triggerLabel}</span> : null}
        {icon ?? <IconMore />}
      </button>
      {open ? (
        <span className="pd-menu-panel" role="menu" aria-label={label}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="pd-menu-item"
              data-danger={item.danger === true ? 'true' : 'false'}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                if (item.disabled !== true) item.onSelect()
              }}
            >
              {item.icon !== undefined ? <span className="pd-menu-item-icon">{item.icon}</span> : null}
              <span>{item.label}</span>
            </button>
          ))}
        </span>
      ) : null}
    </span>
  )
}

export interface RatingProps {
  value: number
  onChange?: (value: number) => void
  label?: string
  disabled?: boolean
}

const STARS = [1, 2, 3, 4, 5] as const

export function Rating({ value, onChange, label, disabled = false }: RatingProps) {
  const interactive = onChange !== undefined && !disabled
  return (
    <span className="pd-stars" role={interactive ? 'group' : undefined} aria-label={label}>
      {STARS.map((star) => (
        <button
          key={star}
          type="button"
          className="pd-star"
          data-on={star <= value ? 'true' : 'false'}
          aria-label={label === undefined ? String(star) : `${label} ${star}`}
          aria-pressed={star <= value}
          disabled={!interactive}
          onClick={
            interactive
              ? () => {
                  onChange(star === value ? 0 : star)
                }
              : undefined
          }
        >
          <span aria-hidden="true">{star <= value ? '★' : '☆'}</span>
        </button>
      ))}
    </span>
  )
}

/* ── modal ─────────────────────────────────────────────────────────────── */

export interface ModalProps {
  open: boolean
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  onClose: () => void
  wide?: boolean
  className?: string
}

export function Modal({ open, title, description, children, footer, onClose, wide = false, className }: ModalProps) {
  const t = useT()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    const timer = window.setTimeout(() => {
      panelRef.current?.focus()
    }, 0)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      window.clearTimeout(timer)
      if (previous !== null && previous.isConnected) previous.focus()
    }
  }, [open])

  if (!open) return null
  return (
    <div
      className="pd-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRef.current()
      }}
    >
      <div
        ref={panelRef}
        className={classes('pd-modal', wide && 'pd-modal-wide', className)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="pd-modal-head">
          <h2 className="pd-modal-title">{title}</h2>
          <IconButton label={t('common.close')} onClick={() => closeRef.current()}>
            <IconClose />
          </IconButton>
        </div>
        <div className="pd-modal-body">
          {description !== undefined && description !== '' ? <p className="pd-modal-desc">{description}</p> : null}
          {children}
        </div>
        {footer !== undefined ? <div className="pd-modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

/* ── toasts ────────────────────────────────────────────────────────────── */

export type ToastKind = 'info' | 'success' | 'error' | 'warn'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

export interface ToastProps {
  toasts: readonly ToastItem[]
  onDismiss: (id: number) => void
}

export function Toast({ toasts, onDismiss }: ToastProps) {
  const t = useT()
  if (toasts.length === 0) return null
  return (
    <div className="pd-toasts" role="log" aria-label={t('toast.notifications')}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pd-toast"
          data-kind={toast.kind}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          <span className="pd-toast-icon">
            {toast.kind === 'success' ? <IconCheck /> : toast.kind === 'warn' || toast.kind === 'error' ? <IconWarning /> : <IconInfo />}
          </span>
          <span className="pd-toast-message">{toast.message}</span>
          <button
            type="button"
            className="pd-toast-close"
            aria-label={t('toast.dismiss')}
            title={t('toast.dismiss')}
            onClick={() => onDismiss(toast.id)}
          >
            <IconClose size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

/* ── empty state ───────────────────────────────────────────────────────── */

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="pd-empty">
      {icon !== undefined ? <span className="pd-empty-icon">{icon}</span> : null}
      <span className="pd-empty-title">{title}</span>
      {description !== undefined && description !== '' ? <span className="pd-empty-desc">{description}</span> : null}
      {action !== undefined ? <div className="pd-empty-actions">{action}</div> : null}
    </div>
  )
}
