/**
 * Cloud-drive friendly sync layer (DESIGN §3.6).
 *
 * The library is a plain directory that may live inside iCloud Drive, Dropbox,
 * OneDrive, Nutstore, Baidu Netdisk or a Syncthing folder. This module:
 *
 *  - detects the cloud provider from the root path,
 *  - fingerprints the user-visible files (`scan.json`) and diffs them so
 *    changes made by another device/Finder/agent become visible,
 *  - writes conflict copies under `.paperdesk/conflicts/` and resolves them,
 *  - detects iCloud evicted placeholders and can ask macOS `brctl` to download
 *    them.
 *
 * Write policy: this module only writes below `<root>/.paperdesk/`, except
 * `resolveConflict('use-conflict')`, which copies a conflict copy back onto its
 * target inside `<root>/papers/<paperId>/` (strictly confined).
 */

import { spawn } from 'node:child_process'
import { constants, existsSync } from 'node:fs'
import {
  access,
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import type {
  CloudInfo,
  ConflictEntry,
  FileFingerprint,
  ScanDelta,
  ScanSnapshot,
  SyncStatus,
} from './types.js'
import { atomicWrite, fileInfo, nowIso, posixJoin, readJsonFile, safeJoin, writeJsonFile } from './util.js'

/** Library layout constants (mirrors src/library.ts; local to avoid a cycle). */
const PAPERS_DIR = 'papers'
const INBOX_DIR = '_inbox'
const INTERNAL_DIR = '.paperdesk'
const CONFLICTS_DIR = 'conflicts'
const SNAPSHOT_FILE = 'scan.json'

/** Directories that are never part of the user-visible library. */
const EXCLUDED_DIRS = new Set([INTERNAL_DIR, '.git'])
/** iCloud placeholder suffix. */
const ICLOUD_SUFFIX = '.icloud'
/** Timeout for `brctl download` (DESIGN §3.6). */
const BRCTL_TIMEOUT_MS = 20_000
/** 8.3-style timestamp used in conflict copy names. */
const DEVICE_SHORT_MAX = 8
const PAPER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

const CLOUD_LABELS: Record<Exclude<CloudInfo['kind'], 'local'>, string> = {
  icloud: 'iCloud 云盘',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox',
  nutstore: '坚果云',
  baidu: '百度网盘',
  syncthing: 'Syncthing',
}
const LOCAL_LABEL = '本地目录'

/* -------------------------------------------------------------------------- */
/* cloud detection                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Detect the sync provider that manages `root` (or one of its ancestors) from
 * the path, plus a few filesystem markers (`.stfolder` for Syncthing).
 */
export function detectCloud(root: string): CloudInfo {
  if (typeof root !== 'string' || root.trim().length === 0) {
    return { kind: 'local', label: LOCAL_LABEL, synced: false }
  }
  const resolved = path.resolve(root)
  const posix = resolved.replace(/\\/g, '/')
  const lower = posix.toLowerCase()

  const icloud = (): CloudInfo => ({
    kind: 'icloud',
    label: CLOUD_LABELS.icloud,
    synced: true,
  })
  if (
    lower.includes('/library/mobile documents/com~apple~clouddocs') ||
    lower.includes('/com~apple~clouddocs')
  ) {
    return icloud()
  }
  if (lower.includes('cloudstorage/onedrive') || lower.includes('/onedrive')) {
    return { kind: 'onedrive', label: CLOUD_LABELS.onedrive, synced: true }
  }
  if (lower.includes('/dropbox')) {
    return { kind: 'dropbox', label: CLOUD_LABELS.dropbox, synced: true }
  }
  if (lower.includes('/nutstore') || posix.includes('坚果云')) {
    return { kind: 'nutstore', label: CLOUD_LABELS.nutstore, synced: true }
  }
  if (lower.includes('/baidunetdisk') || lower.includes('/baidu netdisk') || posix.includes('百度网盘')) {
    return { kind: 'baidu', label: CLOUD_LABELS.baidu, synced: true }
  }
  if (isSyncthingRoot(resolved, lower)) {
    return { kind: 'syncthing', label: CLOUD_LABELS.syncthing, synced: true }
  }
  return { kind: 'local', label: LOCAL_LABEL, synced: false }
}

function isSyncthingRoot(resolved: string, lower: string): boolean {
  try {
    if (existsSync(path.join(resolved, '.stfolder'))) return true
  } catch {
    // ignore
  }
  return lower
    .split('/')
    .filter(Boolean)
    .includes('sync')
}

/* -------------------------------------------------------------------------- */
/* scanning                                                                    */
/* -------------------------------------------------------------------------- */

async function readDirSafe(absDir: string) {
  try {
    return await readdir(absDir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function fingerprintFile(root: string, relPath: string): Promise<FileFingerprint | null> {
  try {
    const info = await fileInfo(safeJoin(root, relPath))
    return info === null ? null : { relPath, size: info.size, mtimeMs: info.mtimeMs }
  } catch {
    // File vanished mid-scan or the path is invalid: skip it.
    return null
  }
}

function byRelPath(a: FileFingerprint, b: FileFingerprint): number {
  if (a.relPath < b.relPath) return -1
  if (a.relPath > b.relPath) return 1
  return 0
}

/** Walk a user-visible directory, skipping hidden dirs/files and `.paperdesk`. */
async function walkVisibleDir(
  root: string,
  relDir: string,
  out: FileFingerprint[],
): Promise<void> {
  const absDir = relDir === '' ? root : safeJoin(root, relDir)
  const entries = await readDirSafe(absDir)
  for (const entry of entries) {
    const name = entry.name
    if (entry.isSymbolicLink()) continue
    const rel = relDir === '' ? name : posixJoin(relDir, name)
    if (entry.isDirectory()) {
      if (name.startsWith('.') || EXCLUDED_DIRS.has(name)) continue
      await walkVisibleDir(root, rel, out)
      continue
    }
    if (!entry.isFile()) continue
    if (name.startsWith('.')) continue
    const fingerprint = await fingerprintFile(root, rel)
    if (fingerprint !== null) out.push(fingerprint)
  }
}

/**
 * Walk `papers/`, `_inbox/` and the root-level `*.pdf` files and return a
 * sorted fingerprint snapshot. `.paperdesk/`, `.git/`, hidden directories and
 * hidden files are excluded.
 */
export async function scanSnapshot(root: string): Promise<ScanSnapshot> {
  const files: FileFingerprint[] = []

  for (const dir of [PAPERS_DIR, INBOX_DIR]) {
    try {
      const dirStat = await stat(safeJoin(root, dir))
      if (dirStat.isDirectory()) await walkVisibleDir(root, dir, files)
    } catch {
      // Directory missing: nothing to scan.
    }
  }

  // PDFs dropped directly in the library root are part of the library too.
  for (const entry of await readDirSafe(root)) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue
    if (!/\.pdf$/i.test(entry.name)) continue
    const fingerprint = await fingerprintFile(root, entry.name)
    if (fingerprint !== null) files.push(fingerprint)
  }

  files.sort(byRelPath)
  return { schemaVersion: 1, scannedAt: nowIso(), files }
}

/** Load `.paperdesk/scan.json`; `null` when absent or invalid. */
export async function loadSnapshot(root: string): Promise<ScanSnapshot | null> {
  try {
    const absPath = safeJoin(root, posixJoin(INTERNAL_DIR, SNAPSHOT_FILE))
    const value = await readJsonFile<ScanSnapshot>(absPath)
    if (typeof value !== 'object' || value === null) return null
    if (value.schemaVersion !== 1 || !Array.isArray(value.files)) return null
    const files: FileFingerprint[] = []
    for (const entry of value.files) {
      if (typeof entry !== 'object' || entry === null) continue
      if (typeof entry.relPath !== 'string') continue
      if (typeof entry.size !== 'number' || typeof entry.mtimeMs !== 'number') continue
      files.push({ relPath: entry.relPath, size: entry.size, mtimeMs: entry.mtimeMs })
    }
    files.sort(byRelPath)
    return {
      schemaVersion: 1,
      scannedAt: typeof value.scannedAt === 'string' ? value.scannedAt : nowIso(),
      files,
    }
  } catch {
    return null
  }
}

/** Persist the snapshot to `.paperdesk/scan.json`. */
export async function saveSnapshot(root: string, snap: ScanSnapshot): Promise<void> {
  const absPath = safeJoin(root, posixJoin(INTERNAL_DIR, SNAPSHOT_FILE))
  await mkdir(path.dirname(absPath), { recursive: true })
  await writeJsonFile(absPath, snap)
}

function diffSnapshots(previous: FileFingerprint[], next: FileFingerprint[]): ScanDelta {
  const previousByPath = new Map(previous.map((file) => [file.relPath, file]))
  const nextPaths = new Set(next.map((file) => file.relPath))
  const added: FileFingerprint[] = []
  const changed: FileFingerprint[] = []
  for (const file of next) {
    const old = previousByPath.get(file.relPath)
    if (old === undefined) {
      added.push(file)
      continue
    }
    if (old.size !== file.size || Math.abs(old.mtimeMs - file.mtimeMs) > 1) changed.push(file)
  }
  const removed = [...previousByPath.keys()]
    .filter((relPath) => !nextPaths.has(relPath))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return { added, changed, removed }
}

/**
 * Snapshot the library, diff it against the stored snapshot, persist the fresh
 * snapshot and return the delta. The very first scan is a baseline: it records
 * every visible file but reports no changes (there is nothing to compare to).
 */
export async function computeDelta(
  root: string,
): Promise<{ delta: ScanDelta; scannedAt: string }> {
  const previous = await loadSnapshot(root)
  const fresh = await scanSnapshot(root)
  const delta =
    previous === null
      ? { added: [], changed: [], removed: [] }
      : diffSnapshots(previous.files, fresh.files)
  await saveSnapshot(root, fresh)
  return { delta, scannedAt: fresh.scannedAt }
}

/* -------------------------------------------------------------------------- */
/* conflict copies                                                             */
/* -------------------------------------------------------------------------- */

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** `YYYYMMDD-HHmmss` in local time. */
function conflictTimestamp(date = new Date()): string {
  return [
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`,
    `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`,
  ].join('-')
}

function deviceShortName(device: string): string {
  const cleaned = (device ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, DEVICE_SHORT_MAX)
  return cleaned || 'local'
}

const CONFLICT_HEADER_MARKER = '<!-- PaperDesk conflict copy'

/** Three-line provenance header prepended to every conflict copy. */
function conflictHeader(relTarget: string, device: string): string {
  const source = relTarget.replace(/[\r\n]+/g, ' ').trim() || '(unknown)'
  return [
    `${CONFLICT_HEADER_MARKER} (do not edit) -->`,
    `<!-- source: ${source} -->`,
    `<!-- saved: ${nowIso()} · device: ${deviceShortName(device)} -->`,
  ].join('\n')
}

function stripConflictHeader(content: string): string {
  const lines = content.split(/\r?\n/)
  if (!(lines[0] ?? '').startsWith(CONFLICT_HEADER_MARKER)) return content
  let index = 0
  while (index < 3 && index < lines.length && (lines[index] ?? '').startsWith('<!--')) {
    index += 1
  }
  return lines.slice(index).join('\n')
}

/**
 * Write `content` to `.paperdesk/conflicts/<paperId>-<timestamp>-<device>.<md|json>`
 * with a provenance header. Never overwrites an existing copy: a numeric suffix
 * is appended when needed. Returns the relative path of the new copy.
 */
export async function writeConflictCopy(
  root: string,
  paperId: string,
  relTarget: string,
  content: string,
  device: string,
): Promise<string> {
  const idPart = PAPER_ID_PATTERN.test(paperId) ? paperId : 'unknown'
  const extension = relTarget.toLowerCase().endsWith('.json') ? 'json' : 'md'
  const dirAbs = safeJoin(root, posixJoin(INTERNAL_DIR, CONFLICTS_DIR))
  await mkdir(dirAbs, { recursive: true })

  const baseName = `${idPart}-${conflictTimestamp()}-${deviceShortName(device)}`
  const payload = `${conflictHeader(relTarget, device)}\n${content}`
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`
    const fileName = `${baseName}${suffix}.${extension}`
    try {
      await writeFile(path.join(dirAbs, fileName), payload, { encoding: 'utf8', flag: 'wx' })
      return posixJoin(INTERNAL_DIR, CONFLICTS_DIR, fileName)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }
  throw new Error('Could not allocate a unique conflict copy file name')
}

function parseConflictName(
  fileName: string,
): { paperId: string; extension: 'md' | 'json' } | null {
  const extensionMatch = /\.(md|json)$/i.exec(fileName)
  if (!extensionMatch) return null
  const extension = extensionMatch[1]?.toLowerCase() === 'json' ? 'json' : 'md'
  const stem = fileName.slice(0, fileName.length - extensionMatch[0].length)
  const parts = stem.split('-')

  const attempt = (stripCounter: boolean): { paperId: string } | null => {
    let index = parts.length - 1
    if (index < 0) return null
    if (stripCounter) {
      const counter = parts[index] ?? ''
      if (!/^\d+$/.test(counter)) return null
      index -= 1
    }
    const device = parts[index] ?? ''
    if (!/^[a-z0-9]+$/i.test(device)) return null
    index -= 1
    const time = parts[index] ?? ''
    if (!/^\d{6}$/.test(time)) return null
    index -= 1
    const day = parts[index] ?? ''
    if (!/^\d{8}$/.test(day)) return null
    index -= 1
    const paperId = parts.slice(0, index + 1).join('-')
    if (!PAPER_ID_PATTERN.test(paperId)) return null
    return { paperId }
  }

  const withoutCounter = attempt(false)
  if (withoutCounter) return { ...withoutCounter, extension }
  const withCounter = attempt(true)
  if (withCounter) return { ...withCounter, extension }
  return null
}

function paperIdFromConflictName(fileName: string): string | null {
  return parseConflictName(fileName)?.paperId ?? null
}

/** All conflict copies under `.paperdesk/conflicts/`, newest first. */
export async function listConflicts(root: string): Promise<ConflictEntry[]> {
  let dirAbs: string
  try {
    dirAbs = safeJoin(root, posixJoin(INTERNAL_DIR, CONFLICTS_DIR))
  } catch {
    return []
  }
  const entries = await readDirSafe(dirAbs)
  const result: ConflictEntry[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const info = await fileInfo(path.join(dirAbs, entry.name)).catch(() => null)
    if (info === null) continue
    result.push({
      relPath: posixJoin(INTERNAL_DIR, CONFLICTS_DIR, entry.name),
      paperId: paperIdFromConflictName(entry.name),
      mtimeMs: info.mtimeMs,
      size: info.size,
    })
  }
  result.sort((a, b) => b.mtimeMs - a.mtimeMs || a.relPath.localeCompare(b.relPath))
  return result
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : String(error)
}

/**
 * Resolve one conflict copy.
 *
 * `use-conflict`: copy the conflict content (header stripped) over
 * `papers/<paperId>/notes.md` or `meta.json`, then delete the conflict copy.
 * `discard-conflict`: only delete the conflict copy.
 *
 * The paper directory is derived from the conflict file name and confined to
 * `<root>/papers/`; failures are returned, never thrown.
 */
export async function resolveConflict(
  root: string,
  relPath: string,
  action: 'use-conflict' | 'discard-conflict',
): Promise<{ ok: boolean; message?: string }> {
  try {
    if (action !== 'use-conflict' && action !== 'discard-conflict') {
      return { ok: false, message: 'invalid action' }
    }
    const normalized = relPath.replace(/\\/g, '/')
    const prefix = `${INTERNAL_DIR}/${CONFLICTS_DIR}/`
    if (!normalized.startsWith(prefix)) {
      return { ok: false, message: 'not a conflict copy path' }
    }
    const fileName = normalized.slice(prefix.length)
    if (!fileName || fileName.includes('/') || fileName.includes('..')) {
      return { ok: false, message: 'invalid conflict copy path' }
    }
    const conflictAbs = safeJoin(root, posixJoin(INTERNAL_DIR, CONFLICTS_DIR, fileName))
    const parsed = parseConflictName(fileName)
    if (parsed === null) {
      return { ok: false, message: 'cannot derive the paper from the conflict file name' }
    }

    const targetRel = posixJoin(
      PAPERS_DIR,
      parsed.paperId,
      parsed.extension === 'json' ? 'meta.json' : 'notes.md',
    )
    const targetAbs = safeJoin(root, targetRel)
    const paperDirAbs = path.resolve(root, PAPERS_DIR, parsed.paperId)
    if (path.dirname(targetAbs) !== paperDirAbs) {
      return { ok: false, message: 'conflict target escapes the paper directory' }
    }

    let body = ''
    if (action === 'use-conflict') {
      try {
        body = stripConflictHeader(await readFile(conflictAbs, 'utf8'))
      } catch {
        return { ok: false, message: 'conflict copy not found' }
      }
      const paperDirStat = await stat(paperDirAbs).catch(() => null)
      if (paperDirStat === null || !paperDirStat.isDirectory()) {
        return { ok: false, message: 'paper directory not found' }
      }
      await atomicWrite(targetAbs, body)
    }

    try {
      await unlink(conflictAbs)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && action === 'discard-conflict') {
        return { ok: false, message: 'conflict copy not found' }
      }
      return { ok: false, message: `could not delete conflict copy: ${errorMessage(error)}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

/* -------------------------------------------------------------------------- */
/* iCloud evicted placeholders                                                 */
/* -------------------------------------------------------------------------- */

interface IcloudPlaceholder {
  logicalRel: string
}

/**
 * Walk the library for iCloud placeholders (`.<name>.icloud`). Hidden files are
 * included here (that is how iCloud marks evicted files); hidden directories
 * are still skipped.
 */
async function collectIcloudPlaceholders(root: string): Promise<IcloudPlaceholder[]> {
  const result: IcloudPlaceholder[] = []
  const walk = async (relDir: string): Promise<void> => {
    let absDir: string
    try {
      absDir = relDir === '' ? root : safeJoin(root, relDir)
    } catch {
      return
    }
    for (const entry of await readDirSafe(absDir)) {
      const rel = relDir === '' ? entry.name : posixJoin(relDir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) continue
        await walk(rel)
        continue
      }
      if (!entry.isFile()) continue
      if (!entry.name.startsWith('.') || !entry.name.toLowerCase().endsWith(ICLOUD_SUFFIX)) {
        continue
      }
      const logicalName = entry.name.slice(1, -ICLOUD_SUFFIX.length)
      if (!logicalName) continue
      result.push({
        logicalRel: relDir === '' ? logicalName : posixJoin(relDir, logicalName),
      })
    }
  }
  await walk('')
  return result
}

function paperIdOfRelPath(relPath: string): string | null {
  const match = /^papers\/([^/]+)\//.exec(relPath)
  if (!match?.[1]) return null
  return PAPER_ID_PATTERN.test(match[1]) ? match[1] : null
}

/**
 * iCloud placeholder files that are not materialized locally. The logical path
 * (e.g. `papers/<id>/paper.pdf`) is reported, not the hidden `.icloud` file.
 */
export async function listEvicted(
  root: string,
): Promise<{ relPath: string; paperId: string | null }[]> {
  const placeholders = await collectIcloudPlaceholders(root)
  const seen = new Set<string>()
  const result: { relPath: string; paperId: string | null }[] = []
  for (const placeholder of placeholders) {
    if (seen.has(placeholder.logicalRel)) continue
    seen.add(placeholder.logicalRel)
    let info: { size: number; mtimeMs: number } | null = null
    try {
      info = await fileInfo(safeJoin(root, placeholder.logicalRel))
    } catch {
      info = null
    }
    // A positive-size logical file means iCloud already materialized it.
    if (info !== null && info.size > 0) continue
    result.push({
      relPath: placeholder.logicalRel,
      paperId: paperIdOfRelPath(placeholder.logicalRel),
    })
  }
  result.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return result
}

function runBrctl(downloadPath: string): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolve) => {
    let settled = false
    let stderr = ''
    let child: ReturnType<typeof spawn>
    const finish = (value: { ok: boolean; message?: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
      finish({ ok: false, message: 'brctl download timed out after 20s' })
    }, BRCTL_TIMEOUT_MS)
    timer.unref?.()
    try {
      child = spawn('brctl', ['download', downloadPath], { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (error) {
      finish({ ok: false, message: `could not start brctl: ${errorMessage(error)}` })
      return
    }
    child.stderr?.on('data', (chunk: unknown) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2_000)
    })
    child.on('error', (error) => {
      finish({ ok: false, message: `brctl unavailable: ${error.message}` })
    })
    child.on('close', (code) => {
      if (code === 0) finish({ ok: true })
      else finish({ ok: false, message: stderr.trim() || `brctl exited with code ${code ?? 'unknown'}` })
    })
  })
}

/**
 * Ask iCloud to download an evicted file (`brctl download`). macOS only; other
 * platforms report `{ ok: false, message: 'not supported' }`.
 */
export async function downloadEvicted(
  root: string,
  relPath: string,
): Promise<{ ok: boolean; message?: string }> {
  if (process.platform !== 'darwin') {
    return { ok: false, message: 'not supported' }
  }
  let absPath: string
  try {
    absPath = safeJoin(root, relPath)
  } catch {
    return { ok: false, message: 'invalid path' }
  }

  const placeholderAbs = path.join(
    path.dirname(absPath),
    `.${path.basename(absPath)}${ICLOUD_SUFFIX}`,
  )
  let target = absPath
  if (existsSync(placeholderAbs)) {
    target = placeholderAbs
  } else {
    try {
      await access(absPath, constants.F_OK)
    } catch {
      return { ok: false, message: 'file not found' }
    }
  }
  return runBrctl(target)
}

/* -------------------------------------------------------------------------- */
/* sync status                                                                 */
/* -------------------------------------------------------------------------- */

function countPdfs(files: FileFingerprint[]): number {
  const paperDirs = new Set<string>()
  let loosePdfs = 0
  for (const file of files) {
    if (!/\.pdf$/i.test(file.relPath)) continue
    const match = /^papers\/([^/]+)\//.exec(file.relPath)
    if (match?.[1]) {
      paperDirs.add(match[1])
      continue
    }
    // Inbox PDFs are not part of the library yet.
    if (file.relPath.startsWith(`${INBOX_DIR}/`)) continue
    loosePdfs += 1
  }
  return paperDirs.size + loosePdfs
}

async function isReadOnly(root: string): Promise<boolean> {
  try {
    await access(root, constants.W_OK)
    return false
  } catch {
    return true
  }
}

/** Everything the sync panel needs. Read-only: never writes the snapshot. */
export async function syncStatus(root: string, device: string): Promise<SyncStatus> {
  const snapshot = await loadSnapshot(root)
  const [fresh, conflicts, evicted, readOnly] = await Promise.all([
    scanSnapshot(root),
    listConflicts(root),
    listEvicted(root),
    isReadOnly(root),
  ])
  const delta: ScanDelta =
    snapshot === null
      ? { added: [], changed: [], removed: [] }
      : diffSnapshots(snapshot.files, fresh.files)

  return {
    cloud: detectCloud(root),
    root: path.resolve(root),
    trackedFiles: snapshot?.files.length ?? 0,
    pdfCount: countPdfs(fresh.files),
    delta,
    conflicts,
    evicted,
    lastScanAt: snapshot?.scannedAt ?? null,
    deviceId: device,
    readOnly,
  }
}
