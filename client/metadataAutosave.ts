import type { PaperMeta } from '../src/types.js'
import { acknowledgeMetadata, metadataFormPatch, reconcileMetaForm, toMetaForm, type MetaForm } from './metaForm.js'
export interface MetadataSaveState { form: MetaForm; phase: 'saved' | 'pending' | 'saving' | 'error'; error: string | null; storageError?: boolean }

/** One serialized writer per mounted paper, retaining newer typing during a save. */
export function createMetadataAutosave(initial: PaperMeta, options: {
  save: (patch: Partial<PaperMeta>, expected: Partial<PaperMeta>) => Promise<PaperMeta>
  applied: (meta: PaperMeta) => void
  delay?: number
  draftKey?: string
}) {
  let server = initial
  let state: MetadataSaveState = { form: toMetaForm(initial), phase: 'saved', error: null }
  if (options.draftKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(options.draftKey) || 'null') as { server?: PaperMeta; form?: MetaForm } | null
      if (saved?.server?.id === initial.id && saved.form && Object.keys(state.form).every((key) => typeof saved.form![key as keyof MetaForm] === typeof state.form[key as keyof MetaForm])) {
        state = { form: reconcileMetaForm(saved.form, saved.server, initial), phase: 'pending', error: null }
      }
    } catch { state = { ...state, storageError: true } }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let work: Promise<boolean> | undefined
  let disposed = false
  const listeners = new Set<() => void>()
  const publish = (next: MetadataSaveState) => {
    state = next
    if (options.draftKey) {
      try {
        if (state.phase === 'saved') localStorage.removeItem(options.draftKey)
        else localStorage.setItem(options.draftKey, JSON.stringify({ server, form: state.form }))
      } catch { state = { ...state, storageError: true } }
    }
    listeners.forEach((listener) => listener())
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    if (!work) timer = setTimeout(() => { timer = undefined; void flush() }, options.delay ?? 800)
  }
  const flush = (): Promise<boolean> => {
    if (timer) { clearTimeout(timer); timer = undefined }
    if (work) return work
    const run = async () => {
      while (true) {
        const sent = { ...state.form }
        let changes: ReturnType<typeof metadataFormPatch>
        try { changes = metadataFormPatch(sent, server) }
        catch (error) { publish({ ...state, phase: 'error', error: error instanceof Error ? error.message : String(error) }); return false }
        if (!Object.keys(changes.patch).length) { publish({ form: acknowledgeMetadata(state.form, sent, server), phase: 'saved', error: null }); return true }
        publish({ ...state, phase: 'saving', error: null })
        try {
          const incoming = await options.save(changes.patch, changes.expected)
          server = incoming
          publish({ form: acknowledgeMetadata(state.form, sent, incoming), phase: 'saved', error: null })
          options.applied(incoming)
          if (JSON.stringify(state.form) === JSON.stringify(toMetaForm(server))) return true
          // New typing is coalesced into the next request, never overwritten by this acknowledgement.
          if (!disposed) { publish({ ...state, phase: 'pending' }); return true }
        } catch (error) { publish({ ...state, phase: 'error', error: error instanceof Error ? error.message : String(error) }); return false }
      }
    }
    work = run().finally(() => {
      work = undefined
      if (state.phase === 'pending') schedule()
    })
    return work
  }
  if (state.phase === 'pending') schedule()
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    update<K extends keyof MetaForm>(key: K, value: MetaForm[K]) { publish({ form: { ...state.form, [key]: value }, phase: 'pending', error: null }); schedule() },
    receive(meta: PaperMeta) {
      if (meta.id !== initial.id) return
      const form = reconcileMetaForm(state.form, server, meta)
      server = meta
      const dirty = JSON.stringify(form) !== JSON.stringify(toMetaForm(meta))
      publish({ form, phase: work ? 'saving' : dirty ? state.phase : 'saved', error: dirty ? state.error : null })
    },
    flush,
    dispose() { disposed = true; listeners.clear(); void flush() },
  }
}
