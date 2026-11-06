/**
 * Cordis plugin config. The schema drives the Host settings form and provides
 * the "config" layer of the settings resolution order (see settings.ts).
 * Every field has a default so an existing profile without a config block
 * still activates with safe values.
 */

import Schema from '@deepseek-ai/schemastery'

export type Language = 'zh' | 'en'

export interface Config {
  /** Absolute path of the managed library root; '' means unconfigured. */
  libraryPath: string
  /** Language for canonical note headings and UI defaults. */
  language: Language
  /** Try Crossref enrichment during import (network, optional). */
  enrich: boolean
  /** Import PDFs dropped into `<root>/_inbox` when the panel scans. */
  autoImportInbox: boolean
  /** Maximum accepted PDF upload size in bytes; 0 = no limit (default). */
  maxPdfBytes: number
  /** Auto-create citation edges from PDF references after import. */
  citationSync: boolean
}

/** Result type of the schemastery object below. */
export type ConfigSchema = Schemastery<Config>

export const Config: ConfigSchema = Schema.object({
  libraryPath: Schema.string().default(''),
  language: Schema.union(['zh', 'en']).default('zh'),
  enrich: Schema.boolean().default(true),
  autoImportInbox: Schema.boolean().default(true),
  maxPdfBytes: Schema.natural().default(0),
  citationSync: Schema.boolean().default(false),
})
