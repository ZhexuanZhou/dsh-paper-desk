/**
 * Low-level helpers shared by the PaperDesk Host: path confinement, hashing,
 * atomic file writes and small filesystem probes. Nothing in here may escape
 * the library root on its own — callers use {@link safeJoin} for that.
 */

import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Read the plugin's own package.json (cached). Never throws. */
let packageCacheLoaded = false
let packageCache: { name?: string; version?: string } | undefined

export function readPackageJson(): { name?: string; version?: string } | undefined {
  if (packageCacheLoaded) return packageCache
  packageCacheLoaded = true
  try {
    // Works from both `src/` (type-stripped dev runs) and compiled `lib/`.
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown }
    packageCache = {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      version: typeof parsed.version === 'string' ? parsed.version : undefined,
    }
  } catch {
    packageCache = undefined
  }
  return packageCache
}

/** Current time as an ISO-8601 string (UTC). */
export function nowIso(): string {
  return new Date().toISOString()
}

/** Lowercase hex sha256 of a string (utf8) or raw bytes. */
export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Lowercase hex sha256 of a file's bytes, streamed so large PDFs stay cheap. */
export async function sha256File(absPath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(absPath)
  try {
    for await (const chunk of stream) hash.update(chunk as Buffer)
  } finally {
    stream.destroy()
  }
  return hash.digest('hex')
}

/**
 * Resolve a library-relative path to an absolute path, refusing anything that
 * escapes `root` (absolute input, `..` traversal, NUL bytes).
 */
export function safeJoin(root: string, relPath: string): string {
  if (typeof relPath !== 'string' || relPath.includes('\0')) {
    throw new Error('invalid path: not a plain relative path')
  }
  if (path.isAbsolute(relPath)) {
    throw new Error(`path escapes library root: ${relPath}`)
  }
  const rootAbs = path.resolve(root)
  // Accept Windows-style separators from clients, but resolve posix-relative.
  const target = path.resolve(rootAbs, relPath.replace(/\\/g, '/'))
  const rel = path.relative(rootAbs, target)
  if (rel === '') return target
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`path escapes library root: ${relPath}`)
  }
  return target
}

/** Inverse of {@link safeJoin}: posix-relative path, throws when outside root. */
export function relOf(root: string, abs: string): string {
  const rel = path.relative(path.resolve(root), path.resolve(abs))
  if (rel === '') return ''
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`path is outside library root: ${abs}`)
  }
  return rel.split(path.sep).join('/')
}

/** Normalize one exclude pattern or relPath to a posix path without `./` / trailing `/`. */
function normalizeRel(value: string): string {
  let out = value.replace(/\\/g, '/').trim()
  while (out.startsWith('./')) out = out.slice(2)
  out = out.replace(/^\/+/, '').replace(/\/+$/, '')
  return out
}

/** Does `relPath` fall under any of the exclude entries? Supports `*` and `**`. */
export function isExcluded(relPath: string, exclude: string[]): boolean {
  const rel = normalizeRel(relPath)
  if (!rel) return false
  for (const entry of exclude) {
    const pattern = normalizeRel(entry)
    if (pattern && matchesPattern(rel, pattern)) return true
  }
  return false
}

function matchesPattern(rel: string, pattern: string): boolean {
  if (pattern.includes('*') || pattern.includes('?')) {
    const body = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\u0000/g, '.*')
    // A pattern without a slash matches at any depth (a directory name).
    const source = pattern.includes('/') ? `^${body}(?:/|$)` : `(?:^|/)${body}(?:/|$)`
    return new RegExp(source).test(rel)
  }
  if (pattern.includes('/')) return rel === pattern || rel.startsWith(`${pattern}/`)
  return rel.split('/').includes(pattern) || rel === pattern
}

/** ASCII url-safe slug used for paper ids. */
export function slugify(text: string, maxLen = 48): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, Math.max(1, maxLen))
    .replace(/-+$/g, '')
  return slug || 'paper'
}

/**
 * Write text or bytes atomically: write a sibling temp file, then rename it
 * over the target. Creates the parent directory when needed.
 */
export async function atomicWrite(absPath: string, data: string | Uint8Array): Promise<void> {
  const dir = path.dirname(absPath)
  await mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(absPath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    await writeFile(tmp, data)
    await rename(tmp, absPath)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

/** Parse a JSON file, returning `undefined` for missing or corrupt content. */
export async function readJsonFile<T>(absPath: string): Promise<T | undefined> {
  try {
    const raw = await readFile(absPath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

/** Pretty-print a JSON value atomically (with a trailing newline). */
export async function writeJsonFile(absPath: string, value: unknown): Promise<void> {
  await atomicWrite(absPath, `${JSON.stringify(value, null, 2)}\n`)
}

/** `size`/`mtimeMs` of a path, or `null` when it does not exist / is unreadable. */
export async function fileInfo(absPath: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const info = await stat(absPath)
    return { size: info.size, mtimeMs: info.mtimeMs }
  } catch {
    return null
  }
}

/** Join path segments with `/`, collapsing empty segments and `.` / `..`. */
export function posixJoin(...parts: string[]): string {
  const stack: string[] = []
  let absolute = false
  parts.forEach((part, index) => {
    if (!part) return
    if (index === 0 && part.startsWith('/')) absolute = true
    for (const segment of part.replace(/\\/g, '/').split('/')) {
      if (!segment || segment === '.') continue
      if (segment === '..') {
        stack.pop()
        continue
      }
      stack.push(segment)
    }
  })
  return `${absolute ? '/' : ''}${stack.join('/')}`
}
