/**
 * Build the browser half (lib/client.js) in the format the dsh client module
 * system expects: `window.__ModuleLoader__.load({ id, factory })` where the
 * factory is a lazy-CJS body whose `require()` calls resolve against the
 * platform seed words and the module table (react, slots, client runtime…).
 *
 * Platform externals mirror packages/client/web/src/seed.ts; the bundle must
 * not import any other plugin's code by value. Non-external imports (e.g. the
 * `marked` markdown renderer) are bundled into this file.
 */
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

/** Package name = module-table handoff id. */
const ID = 'dsh-paper-desk'

/** Platform seed words + module-table entries the factory may require(). */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

const result = await build({
  entryPoints: [path.join(root, 'client/index.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  target: ['es2022'],
  external: EXTERNALS,
  write: false,
  logLevel: 'warning',
})

const code = result.outputFiles[0]?.text
if (code === undefined) throw new Error('esbuild produced no output')

const wrapped = [
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(ID)},`,
  '\tfactory: (require) => {',
  '\t\t"use strict";',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  code
    .split('\n')
    .map((line) => `\t\t${line}`)
    .join('\n'),
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')

await mkdir(path.join(root, 'lib'), { recursive: true })
await writeFile(path.join(root, 'lib/client.js'), wrapped, 'utf8')
console.log(`[build-client] wrote lib/client.js (${wrapped.length} bytes)`)

// Hand-written declaration so package consumers can type the module table
// handoff even though the bundle itself is browser-only.
const dts = [
  'export declare const name: string',
  'export declare const inject: string[]',
  'export declare function apply(ctx: unknown): void',
  '',
].join('\n')
await writeFile(path.join(root, 'lib/client.d.ts'), dts, 'utf8')
console.log('[build-client] wrote lib/client.d.ts')
