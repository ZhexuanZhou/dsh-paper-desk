import { ApiError } from './api.js'
import { useT, errorText } from './i18n.js'
import { Button, Spinner } from './ui.js'

/** Keep unavailable features out of an apparently usable, empty form. */
export function FeatureLoadState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT()
  if (error === null) return <div className="pd-feature-state" role="status"><Spinner /><p>{t('feature.loading')}</p></div>
  const missingBackend = error instanceof ApiError && error.status === 404
  return (
    <section className="pd-feature-state" role="alert">
      <h2>{t(missingBackend ? 'feature.backendTitle' : 'feature.loadTitle')}</h2>
      <p>{t(missingBackend ? 'feature.backendHint' : 'feature.loadHint')}</p>
      <Button onClick={onRetry}>{t('research.reload')}</Button>
      {!missingBackend ? <details><summary>{t('feature.details')}</summary><p>{errorText(error)}</p></details> : null}
    </section>
  )
}
