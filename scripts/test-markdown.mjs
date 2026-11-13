/** Exercise the delivered module-loader bundle, not just an unwrapped source build. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = await mkdtemp(path.join(os.tmpdir(), 'paperdesk-markdown-'))
let checks = 0
const check = (label, actual, expected) => { assert.deepEqual(actual, expected, label); checks++; console.log(`ok ${label}`) }
try {
  const file = path.join(root, 'markdown.mjs')
  await build({ entryPoints: ['client/markdown.tsx'], bundle: true, platform: 'node', format: 'esm', outfile: file })
  const source = await import(pathToFileURL(file))
  const bundle = await readFile('lib/client.js', 'utf8')
  const footer = 'return module.exports;'
  assert.equal(bundle.split(footer).length, 2, 'one module-loader footer')
  // Expose existing local functions after the real factory body has executed.
  // This changes no renderer/lexer code or multiline string in the artifact.
  const probe = bundle.replace(footer, 'module.exports.__markdown = {renderMarkdown, renderMarkdownSectioned, noteOutline}; return module.exports;')
  let module
  vm.runInNewContext(probe, {
    window: { __ModuleLoader__: { load(value) { module = value } } },
    console, setTimeout, clearTimeout, URL, TextEncoder, TextDecoder,
  }, { timeout: 10_000 })
  const delivered = module.factory(require).__markdown
  const examples = [
    ['section after loose lists', '- First\n  - Detail\n\n## Next section\n\n1. One\n2. Two\n\nFinal paragraph.'],
    ['several independent lists', '## First\n\n- A\n- B\n\n## Second\n\n1. C\n2. D\n\n## Third\n\n- E'],
    ['comparison and punctuation', '**$s>1$ 的 kernel 路径**；$s=1$，$a<b$，$x \\ge 0$。'],
    ['accents and subscripts', '$\\tilde Q$，$\\hat K$，$y_{n+1}$ 与 $N$'],
    ['code retains dollar signs', 'Use `$s>1$` and ``literal ` and $x$``.\n\n```python\nvalue = "$5"\n# $x$ stays code\n```'],
    ['nested fenced code', '- Parent\n\n  ```python\n  value = "$5"\n  ```\n\n## Next\n\nNormal text.'],
    ['tilde and longer fences', '~~~~md\n```\n## Not a heading\n$x$\n~~~~\n\n## Actual\nBody'],
    ['both display delimiters', '$$\n\\sum_{i=1}^N x_i\n$$\n\n\\[a < b\\]\n\nEnd.'],
    ['explicit inline delimiters', 'Check \\(s>1\\) and \\(5\\).'],
    ['currency and escaped dollars', 'Prices $5 and $10, \\$20.\n\n`$5$` is literal.'],
    ['invalid and incomplete expressions', 'Keep $\\unknown{<bad>}$ visible.\n\nStreaming $x+\n\n$$\nunfinished'],
    ['raw HTML is text', '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>'],
    ['unsafe links', '[bad](javascript:alert%281%29) ![bad](data:text/html;base64,AA==)'],
    ['old placeholder-looking prose is literal', 'PAPERDESKMATHFORMULA0 and PAPERDESKCODEBLOCK0 beside $x$.'],
  ]
  if (process.argv[2]) examples.push(['original reported answer', await readFile(process.argv[2], 'utf8')])
  for (const [label, markdown] of examples) {
    check(`published render equals source: ${label}`, delivered.renderMarkdown(markdown), source.renderMarkdown(markdown))
    check(`published section preview equals source: ${label}`, delivered.renderMarkdownSectioned(markdown), source.renderMarkdownSectioned(markdown))
    check(`published outline equals source: ${label}`, JSON.stringify(delivered.noteOutline(markdown)), JSON.stringify(source.noteOutline(markdown)))
  }
  const render = delivered.renderMarkdown
  const math = render('**$s>1$**；$a<b$，$x=1$，$\\tilde Q$')
  check('comparison formulas render as native MathML', (math.match(/<math\b/g) ?? []).length, 4)
  check('math does not depend on host KaTeX HTML wrappers', /class="katex/.test(math), false)
  check('bold wrapper survives inline math', /<strong><span class="pd-math-inline">/.test(math), true)
  check('currency is preserved', /Prices \$5 and \$10/.test(render('Prices $5 and $10')), true)
  check('explicit numeric TeX is supported', /<math\b/.test(render('\\(5\\)')), true)
  check('dollar expressions inside inline code are not typeset', /<math\b/.test(render('`$s>1$`')), false)
  check('dollar expressions inside a long code span are not typeset', /<math\b/.test(render('``literal ` and $x$``')), false)
  const fenced = render('- Parent\n\n  ```py\n  x = "$5"\n  ```\n\n## Next\n\nParagraph.')
  check('fenced code is a block, not an invalid pre inside a paragraph', /<p>\s*<pre>/.test(fenced), false)
  check('a top-level heading closes the preceding list', /<\/ul>\s*<h2>Next<\/h2>/.test(fenced), true)
  check('ordinary nested lists keep their nesting', /<li>Parent<ul>\s*<li>Child/.test(render('- Parent\n  - Child')), true)
  check('display formulas have a separate block container', /<div class="pd-math-block"><math/.test(render('$$\nx^2\n$$')), true)
  check('raw HTML cannot become an executable element', /<(script|img)\b/.test(render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')), false)
  check('unsafe links do not survive as destinations', /(?:href|src)="(?:javascript:|data:)/.test(render('[bad](javascript:alert%281%29) ![bad](data:text/html;base64,AA==)')), false)
  check('invalid TeX remains escaped readable text', /&lt;bad&gt;/.test(render('$\\unknown{<bad>}$')), true)
  check('literal placeholder-looking words are unchanged', render('PAPERDESKMATHFORMULA0 beside $x$').includes('PAPERDESKMATHFORMULA0'), true)
  console.log(`${checks} delivered Markdown checks passed`)
} finally { await rm(root, { recursive: true, force: true }) }
