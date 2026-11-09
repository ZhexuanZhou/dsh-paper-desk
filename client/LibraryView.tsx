/**
 * Left pane of the PaperDesk page: search-driven paper list with status chips,
 * tag filter, sort control, import entry point and drag & drop affordances.
 * Purely presentational — all data and callbacks come from `App`.
 */
import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { PaperStatus, PaperSummary } from '../src/types.js'
import { IconBook, IconImport } from './icons.js'
import { useT } from './i18n.js'
import { Button, Chip, EmptyState, Select, Spinner } from './ui.js'

export type SortKey = 'added' | 'title' | 'year' | 'updated'

const STATUS_FILTERS: readonly (PaperStatus | 'all')[] = ['all', 'unread', 'reading', 'read', 'archived']

function statusText(status: PaperStatus | 'all'): string {
  return status === 'all' ? 'status.all' : `status.${status}`
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

export function LibraryView(props: LibraryViewProps) {
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

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const onMove = (moveEvent: PointerEvent): void => {
      if (resizeFrameRef.current !== null) return
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null
        onWidthChange(Math.min(560, Math.max(240, startWidth + moveEvent.clientX - startX)))
      })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <section
      className="pd-pane pd-pane-list"
      style={collapsed ? { display: 'none' } : { width, flexBasis: width }}
      aria-label={t('list.title')}
    >
      <div className="pd-list-head">
        <div className="pd-list-title-row">
          <IconBook />
          <h2 className="pd-list-title">{t('list.title')}</h2>
          <span className="pd-list-count">{t('list.count', { n: count })}</span>
          <div className="pd-list-tools">
            {loading ? <Spinner size={12} label={t('list.loading')} /> : null}
            <button
              type="button"
              className="pd-list-collapse"
              title={t('list.collapse')}
              aria-label={t('list.collapse')}
              onClick={onToggleCollapsed}
            >
              ‹
            </button>
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

        {papers.length > 0 ? (
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
                      {paper.notePreview !== '' ? <span className="pd-row-note">{paper.notePreview}</span> : null}
                      {paper.tags.length > 0 || paper.pdfEvicted ? (
                        <span className="pd-row-tags">
                          {paper.tags.slice(0, 4).map((tag) => (
                            <span key={`${paper.id}-${tag}`} className="pd-tag">
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
      </div>

      <div className="pd-list-note">
        <span className="pd-list-note-line">
          <IconImport size={13} />
          {t('list.importHint')}
        </span>
      </div>
      <div
        className="pd-list-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('list.resize')}
        onPointerDown={beginResize}
      />
    </section>
  )
}
