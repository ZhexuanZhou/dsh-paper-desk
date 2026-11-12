/**
 * Left pane of the PaperDesk page: search-driven paper list with status chips,
 * tag filter, sort control, import entry point and drag & drop affordances.
 * Purely presentational — all data and callbacks come from `App`.
 */
import { memo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { PaperStatus, PaperSummary } from '../src/types.js'
import { IconBook, IconImport } from './icons.js'
import { useT } from './i18n.js'
import { Button, Chip, EmptyState, Select, Spinner } from './ui.js'

export type SortKey = 'added' | 'title' | 'year' | 'updated'

const STATUS_FILTERS: readonly (PaperStatus | 'all')[] = ['all', 'unread', 'reading', 'read', 'archived']

function statusText(status: PaperStatus | 'all'): string {
  return status === 'all' ? 'status.all' : `status.${status}`
}

/** Local (not synced) preference for the library list presentation. */
const VIEW_STORAGE_KEY = 'paperdesk:library-view'

type LibraryViewMode = 'list' | 'table'

function readStoredViewMode(): LibraryViewMode {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'table' ? 'table' : 'list'
  } catch {
    return 'list'
  }
}

function storeViewMode(mode: LibraryViewMode): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, mode)
  } catch {
    /* Private mode / storage disabled: the toggle still works for this mount. */
  }
}

/** Stable hue (0..359) per tag name — presentation only, never persisted. */
function tagHue(tag: string): number {
  let hash = 2166136261
  for (let index = 0; index < tag.length; index += 1) {
    hash ^= tag.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash) % 360
}

function tagStyle(tag: string): CSSProperties {
  return { '--pd-tag-hue': String(tagHue(tag)) } as unknown as CSSProperties
}

export interface LibraryViewProps {
  papers: readonly PaperSummary[]
  count: number
  loading: boolean
  error: string | null
  selectedId: string | null
  statusFilter: PaperStatus | 'all'
  tagFilter: string
  tags: readonly string[]
  sort: SortKey
  hasFilters: boolean
  importing: boolean
  width: number
  collapsed: boolean
  onToggleCollapsed: () => void
  onWidthChange: (width: number) => void
  onStatusFilter: (status: PaperStatus | 'all') => void
  onTagFilter: (tag: string) => void
  onSort: (sort: SortKey) => void
  onSelect: (id: string) => void
  onImport: () => void
  onRetry: () => void
  onCompare: () => void
  onRelations: () => void
}

function LibraryViewImpl(props: LibraryViewProps) {
  const t = useT()
  const {
    papers,
    count,
    loading,
    error,
    selectedId,
    statusFilter,
    tagFilter,
    tags,
    sort,
    hasFilters,
    importing,
    width,
    collapsed,
    onToggleCollapsed,
    onWidthChange,
    onStatusFilter,
    onTagFilter,
    onSort,
    onSelect,
    onImport,
    onRetry,
    onCompare,
    onRelations,
  } = props

  const tagOptions = [
    { value: '', label: t('list.allTags') },
    ...tags.map((tag) => ({ value: tag, label: tag })),
  ]
  const sortOptions: { value: SortKey; label: string }[] = [
    { value: 'added', label: t('sort.added') },
    { value: 'updated', label: t('sort.updated') },
    { value: 'title', label: t('sort.title') },
    { value: 'year', label: t('sort.year') },
  ]

  const resizeFrameRef = useRef<number | null>(null)
  const sectionRef = useRef<HTMLElement | null>(null)
  const dragWidthRef = useRef(width)
  const [dragging, setDragging] = useState(false)
  const [viewMode, setViewMode] = useState<LibraryViewMode>(readStoredViewMode)

  const toggleViewMode = (): void => {
    const next: LibraryViewMode = viewMode === 'list' ? 'table' : 'list'
    setViewMode(next)
    storeViewMode(next)
  }

  const sortAria = (field: 'title' | 'year'): 'ascending' | 'descending' | 'none' =>
    sort === field ? (field === 'title' ? 'ascending' : 'descending') : 'none'

  const toggleSort = (field: 'title' | 'year'): void => {
    onSort(sort === field ? 'added' : field)
  }

  /**
   * Resize the pane by writing its width directly. Updating App state on every
   * pointermove re-rendered the whole library + reader (including the PDF
   * viewer) at 60fps and made dragging feel heavy; React only gets the final
   * width on pointerup.
   */
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const element = sectionRef.current
    if (element === null) return
    const startX = event.clientX
    const startWidth = width
    dragWidthRef.current = startWidth
    element.style.width = `${startWidth}px`
    element.style.flexBasis = `${startWidth}px`
    setDragging(true)

    const apply = (next: number): void => {
      dragWidthRef.current = next
      element.style.width = `${next}px`
      element.style.flexBasis = `${next}px`
    }
    const onMove = (moveEvent: PointerEvent): void => {
      if (resizeFrameRef.current !== null) return
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null
        apply(Math.min(560, Math.max(240, startWidth + moveEvent.clientX - startX)))
      })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
      setDragging(false)
      onWidthChange(dragWidthRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <section
      ref={sectionRef}
      className="pd-pane pd-pane-list"
      style={collapsed ? { display: 'none' } : dragging ? undefined : { width, flexBasis: width }}
      aria-label={t('list.title')}
    >
      <div className="pd-list-head">
        <div className="pd-list-title-row">
          <IconBook />
          <h2 className="pd-list-title">{t('list.title')}</h2>
          <span className="pd-list-count">{t('list.count', { n: count })}</span>
          <div className="pd-list-tools">
            {loading ? <Spinner size={12} label={t('list.loading')} /> : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={toggleViewMode}
              aria-pressed={viewMode === 'table'}
              title={t('list.view.toggle')}
            >
              {viewMode === 'list' ? t('list.view.table') : t('list.view.list')}
            </Button>
            <Select
              small
              value={sort}
              options={sortOptions}
              onChange={(value) => onSort(value as SortKey)}
              ariaLabel={t('aria.sort')}
              title={t('sort.label')}
            />
          </div>
        </div>
        <div className="pd-chips" role="group" aria-label={t('aria.statusFilter')}>
          {STATUS_FILTERS.map((status) => (
            <Chip
              key={status}
              active={status === statusFilter}
              onClick={() => onStatusFilter(status)}
              title={t(statusText(status))}
            >
              {t(statusText(status))}
            </Chip>
          ))}
        </div>
        <div className="pd-list-launchers">
          <Button size="sm" variant="ghost" onClick={onCompare}>
            {t('library.compare')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onRelations}>
            {t('library.relations')}
          </Button>
        </div>
        <div className="pd-list-title-row">
          <Select
            small
            className="pd-grow"
            value={tagFilter}
            options={tagOptions}
            onChange={onTagFilter}
            ariaLabel={t('aria.tagFilter')}
            title={t('list.filterTag')}
          />
        </div>
      </div>

      <div className="pd-list-scroll">
        {error !== null ? (
          <div className="pd-detail-error" role="alert">
            <span>{t('list.error')}</span>
            <span>{error}</span>
            <Button size="sm" onClick={onRetry} loading={loading}>
              {t('common.retry')}
            </Button>
          </div>
        ) : null}

        {loading && papers.length === 0 && error === null ? (
          <div className="pd-loading-block">
            <Spinner size={14} label={t('list.loading')} />
            <span>{t('list.loading')}</span>
          </div>
        ) : null}

        {!loading && papers.length === 0 && error === null ? (
          hasFilters ? (
            <EmptyState title={t('list.filtered.title')} description={t('list.filtered.desc')} />
          ) : (
            <EmptyState
              icon={<IconBook size={20} />}
              title={t('list.empty.title')}
              description={t('list.empty.desc')}
              action={
                <Button variant="primary" icon={<IconImport />} onClick={onImport} loading={importing}>
                  {importing ? t('import.importing') : t('import.button')}
                </Button>
              }
            />
          )
        ) : null}

        {papers.length > 0 && viewMode === 'list' ? (
          <ul className="pd-list" role="list">
            {papers.map((paper) => (
              <li key={paper.id}>
                <button
                  type="button"
                  className="pd-row"
                  data-active={paper.id === selectedId ? 'true' : 'false'}
                  aria-current={paper.id === selectedId ? 'true' : undefined}
                  onClick={() => onSelect(paper.id)}
                >
                  <span className="pd-row-top">
                    <span
                      className="pd-dot"
                      data-status={paper.status}
                      title={t(`status.${paper.status}`)}
                    />
                    <span className="pd-row-main">
                      <span className="pd-row-title">{paper.title}</span>
                      {paper.authors.length > 0 ? (
                        <span className="pd-row-authors">{paper.authors.join(', ')}</span>
                      ) : null}
                      <span className="pd-row-meta">
                        {paper.year !== null ? <span>{paper.year}</span> : null}
                        {paper.year !== null && paper.venue !== '' ? (
                          <span className="pd-row-meta-sep" aria-hidden="true">
                            ·
                          </span>
                        ) : null}
                        {paper.venue !== '' ? <span>{paper.venue}</span> : null}
                        {paper.pageCount !== null && paper.pageCount > 0 ? (
                          <>
                            {paper.year !== null || paper.venue !== '' ? (
                              <span className="pd-row-meta-sep" aria-hidden="true">
                                ·
                              </span>
                            ) : null}
                            <span>{t('list.pages', { n: paper.pageCount })}</span>
                          </>
                        ) : null}
                        {paper.rating > 0 ? (
                          <span className="pd-row-rating" title={t('reader.rating')}>
                            ★ {paper.rating}
                          </span>
                        ) : null}
                      </span>
                      {(paper.searchMatch ?? paper.notePreview) !== '' ? <span className="pd-row-note">{paper.searchMatch ?? paper.notePreview}</span> : null}
                      {paper.tags.length > 0 || paper.pdfEvicted ? (
                        <span className="pd-row-tags">
                          {paper.tags.slice(0, 4).map((tag) => (
                            <span key={`${paper.id}-${tag}`} className="pd-tag pd-tag-hue" style={tagStyle(tag)}>
                              {tag}
                            </span>
                          ))}
                          {paper.pdfEvicted ? (
                            <span className="pd-badge" data-kind="warn">
                              {t('list.evicted')}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {papers.length > 0 && viewMode === 'table' ? (
          <div className="pd-table-scroll">
            <table className="pd-table">
              <thead>
                <tr>
                  <th scope="col" aria-sort={sortAria('title')}>
                    <button
                      type="button"
                      className="pd-table-sort"
                      onClick={() => toggleSort('title')}
                      title={t('list.sortTitle')}
                    >
                      {t('list.col.title')}
                      {sort === 'title' ? <span aria-hidden="true"> ↑</span> : null}
                    </button>
                  </th>
                  <th scope="col">{t('list.col.authors')}</th>
                  <th scope="col" aria-sort={sortAria('year')}>
                    <button
                      type="button"
                      className="pd-table-sort"
                      onClick={() => toggleSort('year')}
                      title={t('list.sortYear')}
                    >
                      {t('list.col.year')}
                      {sort === 'year' ? <span aria-hidden="true"> ↓</span> : null}
                    </button>
                  </th>
                  <th scope="col">{t('list.col.tags')}</th>
                </tr>
              </thead>
              <tbody>
                {papers.map((paper) => (
                  <tr
                    key={paper.id}
                    className="pd-table-row"
                    data-active={paper.id === selectedId ? 'true' : 'false'}
                    tabIndex={0}
                    aria-label={paper.title}
                    onClick={() => onSelect(paper.id)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      onSelect(paper.id)
                    }}
                  >
                    <td>
                      <span
                        className="pd-dot"
                        data-status={paper.status}
                        title={t(`status.${paper.status}`)}
                        aria-hidden="true"
                      />
                      <span className="pd-table-title" title={paper.title}>
                        {paper.title}
                      </span>
                    </td>
                    <td className="pd-table-cell-authors" title={paper.authors.join(', ')}>
                      {paper.authors.length > 0 ? paper.authors.join(', ') : '—'}
                    </td>
                    <td className="pd-table-cell-year">{paper.year ?? '—'}</td>
                    <td className="pd-table-cell-tags">
                      {paper.tags.slice(0, 2).map((tag) => (
                        <span key={`${paper.id}-table-${tag}`} className="pd-tag pd-tag-hue" style={tagStyle(tag)}>
                          {tag}
                        </span>
                      ))}
                      {paper.tags.length > 2 ? <span className="pd-tag">+{paper.tags.length - 2}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="pd-list-note">
        <span className="pd-list-note-line">
          <IconImport size={13} />
          {t('list.importHint')}
        </span>
      </div>
      <button
        type="button"
        className="pd-list-collapse"
        title={t('list.collapse')}
        aria-label={t('list.collapse')}
        onClick={onToggleCollapsed}
      >
        ‹
      </button>
      <div
        className="pd-list-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('list.resize')}
        onPointerDown={beginResize}
        onDoubleClick={onToggleCollapsed}
        title={t('list.collapse')}
      />
    </section>
  )
}

/**
 * Ignore callback identity (App creates a few inline callbacks) but re-render
 * whenever data, filters or width change. This keeps typing in the global
 * search box from re-rendering the entire paper list.
 */
export const LibraryView = memo(LibraryViewImpl, (prev, next) => {
  for (const key of Object.keys(prev) as Array<keyof LibraryViewProps>) {
    const a = prev[key]
    const b = next[key]
    if (typeof a === 'function' || typeof b === 'function') continue
    if (a !== b) return false
  }
  return true
})
