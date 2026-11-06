/**
 * Persistent, per-host settings for PaperDesk.
 *
 * Resolution for the library path (highest wins):
 *   1. `$DSH_HOME/paper-desk/settings.json` (the UI-editable file)
 *   2. the Cordis plugin config
 *   3. `DSH_PAPER_DESK_LIBRARY` from the environment
 *
 * The settings file is mtime-cached so status routes can call
 * {@link effectiveSettings} on every request without touching the disk.
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { EffectiveSettings } from './types.js'
import type { Config, Language } from './config.js'

export interface SettingsFile {
  libraryPath?: string
  language?: Language
  enrich?: boolean
  autoImportInbox?: boolean
  maxPdfBytes?: number
}

/** 0 means no limit; uploads are streamed to disk, never buffered whole. */
const DEFAULT_MAX_PDF_BYTES = 0

/** `$DSH_HOME/paper-desk`; `$DSH_HOME` defaults to `~/.dsh`. */
export function settingsHome(): string {
  const raw = process.env.DSH_HOME?.trim()
  const home = raw ? expandTilde(raw) : path.join(os.homedir(), '.dsh')
  return path.join(home, 'paper-desk')
}

/** Absolute path of `settings.json` (it may not exist yet). */
export function settingsFilePath(): string {
  return path.join(settingsHome(), 'settings.json')
}

let settingsCache: { file: string; mtimeMs: number; size: number; value: SettingsFile } | null = null

/** Read the settings file, mtime-cached. Corrupt/missing ⇒ `{}`. */
export function loadSettings(): SettingsFile {
  const file = settingsFilePath()
  let info: { mtimeMs: number; size: number }
  try {
    const stat = statSync(file)
    info = { mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    settingsCache = null
    return {}
  }
  if (
    settingsCache &&
    settingsCache.file === file &&
    settingsCache.mtimeMs === info.mtimeMs &&
    settingsCache.size === info.size
  ) {
    return { ...settingsCache.value }
  }
  let value: SettingsFile = {}
  try {
    value = sanitizeSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    value = {}
  }
  settingsCache = { file, ...info, value }
  return { ...value }
}

/** Resolve the settings layers into the payload handed to routes and the UI. */
export function effectiveSettings(base: Config): EffectiveSettings {
  const file = loadSettings()
  const envPath = process.env.DSH_PAPER_DESK_LIBRARY?.trim() ?? ''

  let libraryPath = ''
  let source: EffectiveSettings['source'] = 'none'
  if (file.libraryPath) {
    libraryPath = file.libraryPath
    source = 'file'
  } else if (base.libraryPath?.trim()) {
    libraryPath = base.libraryPath.trim()
    source = 'config'
  } else if (envPath) {
    libraryPath = envPath
    source = 'env'
  }

  const language: Language = file.language ?? (base.language === 'en' ? 'en' : 'zh')
  return {
    libraryPath: libraryPath ? path.resolve(expandTilde(libraryPath)) : '',
    source,
    language,
    enrich: file.enrich ?? Boolean(base.enrich),
    autoImportInbox: file.autoImportInbox ?? Boolean(base.autoImportInbox),
    maxPdfBytes: nonNegativeInt(file.maxPdfBytes) ?? nonNegativeInt(base.maxPdfBytes) ?? DEFAULT_MAX_PDF_BYTES,
    settingsFile: settingsFilePath(),
  }
}

/**
 * Merge an update into `settings.json` and return the stored file content.
 * An empty `libraryPath` clears the override (falls back to config/env).
 */
export function saveSettings(update: SettingsFile): SettingsFile {
  const next: SettingsFile = { ...loadSettings() }

  if (update.libraryPath !== undefined) {
    const value = typeof update.libraryPath === 'string' ? update.libraryPath.trim() : ''
    if (value) next.libraryPath = value
    else delete next.libraryPath
  }
  if (update.language === 'zh' || update.language === 'en') next.language = update.language
  if (typeof update.enrich === 'boolean') next.enrich = update.enrich
  if (typeof update.autoImportInbox === 'boolean') next.autoImportInbox = update.autoImportInbox
  const maxPdfBytes = nonNegativeInt(update.maxPdfBytes)
  if (maxPdfBytes !== undefined) next.maxPdfBytes = maxPdfBytes

  const file = settingsFilePath()
  mkdirSync(path.dirname(file), { recursive: true })
  // Keep settings writes atomic too: readers must never see half-written JSON.
  const tmp = path.join(path.dirname(file), `.settings.json.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      /* temp file was never created */
    }
    throw error
  }

  try {
    const stat = statSync(file)
    settingsCache = { file, mtimeMs: stat.mtimeMs, size: stat.size, value: { ...next } }
  } catch {
    settingsCache = null
  }
  return { ...next }
}

/** Validate a settings PATCH body. Returns an error message, or `null` when valid. */
export function validateSettingsInput(input: Record<string, unknown>): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'settings must be a JSON object'

  if (input.libraryPath !== undefined) {
    if (typeof input.libraryPath !== 'string') return 'libraryPath must be a string'
    const value = input.libraryPath.trim()
    if (value && !path.isAbsolute(expandTilde(value)) && !value.startsWith('~')) {
      return 'libraryPath must be an absolute path'
    }
  }
  if (input.language !== undefined && input.language !== 'zh' && input.language !== 'en') {
    return 'language must be "zh" or "en"'
  }
  if (input.enrich !== undefined && typeof input.enrich !== 'boolean') {
    return 'enrich must be a boolean'
  }
  if (input.autoImportInbox !== undefined && typeof input.autoImportInbox !== 'boolean') {
    return 'autoImportInbox must be a boolean'
  }
  if (input.maxPdfBytes !== undefined) {
    const value = input.maxPdfBytes
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return 'maxPdfBytes must be a non-negative integer (0 = no limit)'
    }
  }
  return null
}

/** Synchronous directory probe (used by status routes and the UI). */
export function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

let deviceCache: string | null = null

/** Stable per-host device id, persisted in `$DSH_HOME/paper-desk/device.json`. */
export function deviceId(): string {
  if (deviceCache) return deviceCache
  const file = path.join(settingsHome(), 'device.json')
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { id?: unknown }
    if (typeof parsed.id === 'string' && /^[a-z0-9-]{4,64}$/.test(parsed.id)) {
      deviceCache = parsed.id
      return deviceCache
    }
  } catch {
    /* missing or corrupt: regenerate below */
  }
  const id = randomBytes(16).toString('hex')
  deviceCache = id
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, id, createdAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  } catch {
    // A read-only home must not break the plugin; the id stays in memory.
  }
  return id
}

/** Short device tag used in conflict copy names. */
export function deviceShort(): string {
  return deviceId().slice(0, 8)
}

function expandTilde(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2))
  return value
}

function sanitizeSettings(raw: unknown): SettingsFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as Record<string, unknown>
  const out: SettingsFile = {}
  if (typeof record.libraryPath === 'string' && record.libraryPath.trim()) {
    out.libraryPath = record.libraryPath.trim()
  }
  if (record.language === 'zh' || record.language === 'en') out.language = record.language
  if (typeof record.enrich === 'boolean') out.enrich = record.enrich
  if (typeof record.autoImportInbox === 'boolean') out.autoImportInbox = record.autoImportInbox
  const maxPdfBytes = nonNegativeInt(record.maxPdfBytes)
  if (maxPdfBytes !== undefined) out.maxPdfBytes = maxPdfBytes
  return out
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** Like positiveInt but accepts 0, which means no PDF size limit. */
function nonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}
