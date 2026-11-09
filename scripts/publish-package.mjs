#!/usr/bin/env node
/**
 * Publish-ready staging for npm.
 *
 * npm rejects the unscoped name `dsh-paper-desk` as too similar to the existing
 * package `dsh-paperdesk`, so the public package is published under the user's
 * scope as `@zhe_xuan/dsh-paper-desk`. Inside the repo we keep the unscoped
 * name so the local profile can link to it by folder name; this script copies
 * the built artifacts into a clean staging directory with the scoped identity:
 *
 *   - package.json name
 *   - cordis.patch.yml insert name
 *   - lib/client.js module-loader id
 *
 * Usage:
 *   node scripts/publish-package.mjs            # stage into .publish/npm
 *   node scripts/publish-package.mjs --publish  # stage then `npm publish`
 *   node scripts/publish-package.mjs --pack     # stage then `npm pack` (tgz)
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SCOPE = '@zhe_xuan'
const PUBLISHED_NAME = `${SCOPE}/dsh-paper-desk`
const stage = path.join(repo, '.publish', 'npm')
const args = new Set(process.argv.slice(2))

const COPY_FILES = ['README.md', 'cordis.patch.yml', 'icon.svg', 'screenshots.json', 'LICENSE']
const COPY_DIRS = ['lib', 'locale', 'docs/screenshots', 'assets']

async function copyDir(rel) {
  await cp(path.join(repo, rel), path.join(stage, rel), { recursive: true })
}

async function main() {
  await rm(stage, { recursive: true, force: true })
  await mkdir(stage, { recursive: true })
  for (const file of COPY_FILES) await cp(path.join(repo, file), path.join(stage, file))
  for (const dir of COPY_DIRS) await copyDir(dir)

  const pkg = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'))
  pkg.name = PUBLISHED_NAME
  delete pkg.private
  delete pkg.scripts
  delete pkg.devDependencies
  pkg.files = [
    'lib',
    'cordis.patch.yml',
    'locale/*.json',
    'icon.svg',
    'assets/icon-180.png',
    'screenshots.json',
    'README.md',
    'docs/screenshots',
    'LICENSE',
  ]
  await writeFile(path.join(stage, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

  const patchPath = path.join(stage, 'cordis.patch.yml')
  const patch = await readFile(patchPath, 'utf8')
  const scopedPatch = patch.replace('name: dsh-paper-desk', `name: '${PUBLISHED_NAME}'`)
  if (scopedPatch === patch) throw new Error('cordis.patch.yml insert name not found')
  await writeFile(patchPath, scopedPatch)

  const clientPath = path.join(stage, 'lib', 'client.js')
  const client = await readFile(clientPath, 'utf8')
  const marker = 'id: "dsh-paper-desk"'
  if (!client.includes(marker)) throw new Error('client bundle module-loader id not found')
  await writeFile(clientPath, client.replace(marker, `id: "${PUBLISHED_NAME}"`))

  const files = await readdir(stage)
  console.log(`staged ${PUBLISHED_NAME} in ${stage}`)
  console.log(`entries: ${files.join(', ')}`)

  if (args.has('--publish')) {
    execFileSync('npm', ['publish', '--access', 'public'], { cwd: stage, stdio: 'inherit' })
    console.log(`published ${PUBLISHED_NAME}`)
  }
  if (args.has('--pack')) {
    const out = execFileSync('npm', ['pack', '--silent'], { cwd: stage, encoding: 'utf8' }).trim()
    console.log(`tarball: ${path.join(stage, out)}`)
  }
}

await main()
