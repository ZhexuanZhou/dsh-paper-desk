/**
 * PaperDesk browser half: registers the native center panel and its global
 * sidebar icon. The same id (`paper-desk`) addresses both slots, which is how
 * the shell couples a global panel icon to its main panel (the same pattern the
 * installed `dsh-context` plugin uses).
 *
 * The published client-runtime types lag the running shell (its SlotMap only
 * knows `root`), so the two services this module needs are typed structurally
 * here instead of relying on a version-skewed augmentation.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReactElement } from 'react'
import { App } from './App.js'
import { dict } from './i18n.js'
import { PanelIcon } from './icons.js'

export const name = 'paper-desk'

/** Slot registration + locale dictionaries are the only hard services. */
export const inject: string[] = ['slots', 'locale']

const NS = 'paper-desk'
const PANEL = 'paper-desk'

interface SlotServiceLike {
  inject(key: string, callback: () => (() => void) | void): (() => void) | void
  register(options: Record<string, unknown>, component: (props: never) => ReactElement): () => void
}

interface LocaleServiceLike {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
  bind(namespace: string): (key: string) => string
}

interface PaperDeskClientContext {
  effect(callback: () => (() => void) | void, label?: string): (() => void) | void
  slots: SlotServiceLike
  locale: LocaleServiceLike
}

export function apply(ctx: ClientContext): void {
  const client = ctx as unknown as PaperDeskClientContext

  client.effect(() => client.locale.register(NS, dict), 'paper-desk: locale dictionaries')
  const t = client.locale.bind(NS)

  // Native center panel: the shell renders our page where it dispatches this key.
  client.slots.inject('main', () =>
    client.slots.register({ name: 'main', key: PANEL, locale: NS }, () => <App ctx={ctx} />),
  )

  // Global sidebar icon: clicking it selects the `paper-desk` main panel. The
  // owner renders the button and resolves its label from this registration.
  client.slots.inject('sidebar.panellist', () =>
    client.slots.register(
      { name: 'sidebar.panellist', id: PANEL, order: 40, label: () => t('title'), locale: NS },
      ((props: { size?: number }) => <PanelIcon size={props.size ?? 18} />) as unknown as (
        props: never,
      ) => ReactElement,
    ),
  )
}
