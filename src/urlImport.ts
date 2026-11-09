/**
 * Add a paper from a link.
 *
 * Supported: arXiv abs/pdf links and direct PDF URLs (http/https). DOI landing
 * pages are recognised but rejected unless they point at an actual PDF: a
 * paywalled HTML page cannot be stored as a reader PDF.
 *
 * This module deliberately validates every hop (public DNS, http(s), redirects,
 * size, PDF magic) because the URL comes from the user and the Host is a local
 * process.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { createPaper } from './library.js'
import type { CreatePaperOptions } from './library.js'
import type { PaperMeta, PaperSource } from './types.js'

const MAX_BYTES = 80 * 1024 * 1024
const MAX_REDIRECTS = 5
const FETCH_TIMEOUT_MS = 30_000
const USER_AGENT = 'PaperDesk/0.3.13 (+local paper library)'

const ARXIV_URL_RE = /arxiv\.org\/(?:abs|pdf)\/(.+?)(?:\.pdf)?(?:[?#].*)?$/i
const ARXIV_BARE_RE = /^(?:arxiv:)?\s*((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[a-z]{2})?\/\d{7}))(?:v\d+)?\s*$/i
const DOI_RE = /^10\.\d{4,9}\/\S+$/

function privateIpv4(address: string): boolean {
  const octets = address.split('.').map((part) => Number.parseInt(part, 10))
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) return true
  const [a, b] = octets as [number, number, number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

function privateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return privateIpv4(address)
  if (family === 6) {
    const value = address.toLowerCase()
    if (value === '::1' || value === '::' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true
    if (value.startsWith('::ffff:')) return privateIpv4(value.slice(7))
    return false
  }
  return true
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持 http/https 链接')
  if (url.username !== '' || url.password !== '') throw new Error('链接不能包含账号密码')
  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number.parseInt(url.port, 10)
  if (port !== 80 && port !== 443) throw new Error('只支持 80/443 端口')
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local')) throw new Error('不允许访问本机/局域网地址')
  const records = await lookup(host, { all: true, verbatim: true }).catch(() => [])
  if (records.length === 0) throw new Error(`无法解析主机：${host}`)
  for (const record of records) {
    if (privateAddress(record.address)) throw new Error('不允许访问内网地址')
  }
}

function fileNameFromUrl(url: URL, fallback: string): string {
  const base = url.pathname.split('/').filter(Boolean).at(-1) ?? ''
  let decoded = base
  try { decoded = decodeURIComponent(base) } catch {}
  const clean = decoded.replace(/[\\/:*?"<>|\0]/g, '-').trim()
  if (clean.toLowerCase().endsWith('.pdf')) return clean
  return `${fallback}.pdf`
}

async function downloadPdf(initial: URL): Promise<{ bytes: Uint8Array; finalUrl: URL; fileName: string }> {
  let current = initial
  let response: Response | null = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(current)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: 'application/pdf,*/*;q=0.8' },
      })
    } finally {
      clearTimeout(timer)
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location === null || location === '') throw new Error('链接重定向缺少目标')
      current = new URL(location, current)
      continue
    }
    break
  }
  if (response === null) throw new Error('链接下载失败')
  if (!response.ok) throw new Error(`链接返回 HTTP ${response.status}`)
  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('PDF 超过 80MB 限制')
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  if (contentType.includes('text/html')) throw new Error('这是网页而不是 PDF；请粘贴 PDF 直链或 arXiv 链接')
  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.length === 0) throw new Error('下载到的文件为空')
  if (buffer.length > MAX_BYTES) throw new Error('PDF 超过 80MB 限制')
  const magic = new TextDecoder().decode(buffer.slice(0, 5))
  if (magic !== '%PDF-') throw new Error('链接内容不是 PDF')
  return { bytes: buffer, finalUrl: current, fileName: fileNameFromUrl(current, 'paper') }
}

export interface UrlImportOptions {
  language: CreatePaperOptions['language']
  device?: string
  enrich: boolean
}

export async function importPaperFromUrl(
  root: string,
  raw: string,
  options: UrlImportOptions,
): Promise<{ id: string; meta: PaperMeta; duplicated: boolean }> {
  const trimmed = raw.trim()
  if (trimmed === '') throw new Error('请输入链接')

  let source: PaperSource = 'import'
  let downloadUrl: URL
  let fallbackName = 'paper'
  let sourceUrl = trimmed

  if (DOI_RE.test(trimmed)) {
    throw new Error('DOI 页面通常不是 PDF；请粘贴 arXiv 链接或 PDF 直链')
  }

  const bare = ARXIV_BARE_RE.exec(trimmed)
  if (bare !== null) {
    const arxivId = (bare[1] ?? '').trim()
    downloadUrl = new URL(`https://arxiv.org/pdf/${arxivId}`)
    fallbackName = arxivId.replace(/[/.]/g, '-')
    source = 'arxiv'
    sourceUrl = `https://arxiv.org/abs/${arxivId}`
  } else {
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      throw new Error('链接格式不正确')
    }
    sourceUrl = parsed.toString()
    const doiHost = /(^|\.)doi\.org$/i.test(parsed.hostname)
    if (doiHost || DOI_RE.test(parsed.pathname.replace(/^\//, ''))) {
      throw new Error('DOI 页面通常不是 PDF；请粘贴 arXiv 链接或 PDF 直链')
    }
    const arxivMatch = ARXIV_URL_RE.exec(parsed.toString())
    if (arxivMatch !== null && /(^|\.)arxiv\.org$/i.test(parsed.hostname)) {
      const arxivId = (arxivMatch[1] ?? '').replace(/\.pdf$/i, '').trim()
      downloadUrl = new URL(`https://arxiv.org/pdf/${arxivId}`)
      fallbackName = arxivId.replace(/[/.]/g, '-')
      source = 'arxiv'
      sourceUrl = `https://arxiv.org/abs/${arxivId}`
    } else {
      const lowerPath = parsed.pathname.toLowerCase()
      if (!lowerPath.endsWith('.pdf') && !/(^|\/)pdf\/?$/i.test(lowerPath)) {
        throw new Error('链接不是 PDF；支持 arXiv 链接或 PDF 直链')
      }
      downloadUrl = parsed
    }
  }

  const downloaded = await downloadPdf(downloadUrl)
  const { bytes, fileName } = downloaded
  const created = await createPaper(root, {
    bytes,
    fileName: fileName === 'paper.pdf' ? `${fallbackName}.pdf` : fileName,
    source,
    sourceUrl,
    enrich: options.enrich,
    language: options.language,
    device: options.device,
  })
  return created
}
