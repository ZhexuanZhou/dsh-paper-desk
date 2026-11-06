/**
 * Read-only serving of the installed `pdfjs-dist` browser assets.
 *
 * The in-app viewer loads `build/pdf.mjs`, its worker, the viewer CSS, CMaps,
 * standard fonts and wasm decoders from `GET /api/paper-desk/pdfjs/<relPath>`
 * (DESIGN-VIEWER §1). This module is the only place that touches the package
 * directory outside the library root, so the confinement rules are strict:
 *
 *  - only the five public asset roots are allowed (`PDFJS_ASSET_ROOTS`),
 *  - absolute paths, backslashes, NUL bytes, empty segments, `.`/`..` segments
 *    and anything that resolves outside the package directory are rejected,
 *  - only regular files are answered; a single response is capped at 32 MiB.
 *
 * `readPdfjsAsset` never throws: every failure (missing package, missing file,
 * traversal attempt, I/O error, oversized file) is `null`, which the HTTP layer
 * maps to 404.
 */

import { realpathSync, statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

/** Largest single asset we are willing to read into memory (32 MiB). */
const MAX_ASSET_BYTES = 32 * 1024 * 1024

/** Longest accepted relative path (defensive; real asset paths are short). */
const MAX_REL_PATH_LENGTH = 1024

/** Package subdirectories the browser build is allowed to read. */
export const PDFJS_ASSET_ROOTS: readonly string[] = Object.freeze([
  'build',
  'cmaps',
  'standard_fonts',
  'wasm',
  'web',
])

const CONTENT_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.bcmap': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

let cachedPackageDir: string | undefined

/**
 * Absolute directory of the installed `pdfjs-dist` package. Resolved once and
 * cached; throws a readable Error when the package cannot be resolved (for
 * example a broken install). `readPdfjsAsset` catches that and returns `null`.
 */
export function pdfjsPackageDir(): string {
  if (cachedPackageDir !== undefined) return cachedPackageDir

  let packageJson: string
  try {
    packageJson = require.resolve('pdfjs-dist/package.json')
  } catch {
    throw new Error('pdfjs-dist is not installed: could not resolve pdfjs-dist/package.json')
  }
  cachedPackageDir = path.dirname(packageJson)
  return cachedPackageDir
}

/** MIME type for one asset file name (by extension). */
function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? DEFAULT_CONTENT_TYPE
}

/** True when `child` is strictly below `parent` (both absolute). */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  if (rel.length === 0) return false
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) return false
  return !path.isAbsolute(rel)
}

/**
 * Lexically validate a client-supplied relative path. This runs before any
 * filesystem access: it rejects absolute paths, Windows separators, NUL bytes,
 * empty/`.`/`..` segments and any first segment outside `PDFJS_ASSET_ROOTS`.
 */
function isSafeAssetPath(relPath: string): boolean {
  if (typeof relPath !== 'string') return false
  if (relPath.length === 0 || relPath.length > MAX_REL_PATH_LENGTH) return false
  if (relPath.includes('\0') || relPath.includes('\\')) return false
  if (path.isAbsolute(relPath) || relPath.startsWith('/')) return false

  const segments = relPath.split('/')
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.' || segment === '..') return false
  }
  const root = segments[0]
  return root !== undefined && PDFJS_ASSET_ROOTS.includes(root)
}

/**
 * Resolve one asset to an absolute path + content type, or `null` when it is
 * unsafe, missing, not a regular file, or resolves (through a symlink) outside
 * the `pdfjs-dist` package directory.
 */
export function resolvePdfjsAsset(
  relPath: string,
): { abs: string; contentType: string } | null {
  try {
    if (!isSafeAssetPath(relPath)) return null

    const packageDir = pdfjsPackageDir()
    const abs = path.resolve(packageDir, relPath)
    // Lexical confinement first, then symlink-aware confinement.
    if (!isInside(path.resolve(packageDir), abs)) return null

    const packageReal = realpathSync(packageDir)
    const absReal = realpathSync(abs)
    if (!isInside(packageReal, absReal)) return null

    const info = statSync(absReal)
    if (!info.isFile()) return null

    return { abs, contentType: contentTypeFor(abs) }
  } catch {
    return null
  }
}

/**
 * Read one pdf.js asset into memory. Never throws: missing files, traversal
 * attempts, non-files, I/O errors and files above 32 MiB all yield `null`.
 */
export async function readPdfjsAsset(
  relPath: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const asset = resolvePdfjsAsset(relPath)
    if (asset === null) return null

    const info = await stat(asset.abs)
    if (!info.isFile() || info.size > MAX_ASSET_BYTES) return null

    const buffer = await readFile(asset.abs)
    if (buffer.length > MAX_ASSET_BYTES) return null

    return { bytes: new Uint8Array(buffer), contentType: asset.contentType }
  } catch {
    return null
  }
}
