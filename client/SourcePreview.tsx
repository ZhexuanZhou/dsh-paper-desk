import { useEffect, useState } from 'react'
import { api } from './api.js'
import { renderPageImages } from './pageImages.js'
import { useT, errorText } from './i18n.js'
import { Modal, Button, Spinner } from './ui.js'

export function SourcePreview({
  paperId,
  page,
  onClose,
  onJump,
}: {
  paperId: string
  page: number
  onClose: () => void
  onJump: () => void
}) {
  const t = useT()
  const [source, setSource] = useState<{ text: string; image: string } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void Promise.all([api.text(paperId), renderPageImages(api.pdfUrl(paperId), [page])])
      .then(([result, images]) => {
        if (active)
          setSource({
            text: result.text.pages.find((item) => item.page === page)?.text ?? '',
            image: `data:image/jpeg;base64,${images[0]?.data ?? ''}`,
          })
      })
      .catch((err: unknown) => {
        if (active) setError(errorText(err))
      })
    return () => {
      active = false
    }
  }, [paperId, page])
  return (
    <Modal
      open
      title={`${t('source.title')} · p.${page}`}
      onClose={onClose}
      footer={<Button disabled={source === null || error !== ''} onClick={onJump}>{t('source.open')}</Button>}
    >
      <p className="pd-field-hint">{t('source.hint')}</p>
      {error ? (
        <p role="alert">{error}</p>
      ) : source ? (
        <>
          <img className="pd-source-image" src={source.image} alt={`${t('source.title')} p.${page}`} />
          <details>
            <summary>{t('source.text')}</summary>
            <pre className="pd-source-text">{source.text || t('source.noText')}</pre>
          </details>
        </>
      ) : (
        <Spinner />
      )}
    </Modal>
  )
}
