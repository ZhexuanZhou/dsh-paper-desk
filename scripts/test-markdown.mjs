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
  const probe = bundle.replace(footer, 'module.exports.__markdown = {renderMarkdown, renderMarkdownSectioned, noteOutline, cardBodyForDisplay}; return module.exports;')
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
    ['table code with literal pipes', '| Metric | Definition | Source |\n|---|---|---|\n| error | `max_i |ŷ_i − y_i|` | proposed |\n| params | `max(|w−2|, |b−1|)` | proposed |'],
    ['table math with absolute and norm bars', '| Value | Formula |\n|---|---|\n| abs | $|x|$ |\n| norm | $\\|x\\|$ |'],
    ['table header and already escaped code pipes', '| `a|b` | B |\n|---|---|\n| `x\\|y` | $a>b$ |'],
    ['nested table in a quote', '> | Name | Value |\n> |---|---|\n> | A | `x|y` |'],
    ['table-looking fenced code is literal', '```markdown\n| A | B |\n|---|---|\n| code | `x|y` |\n```'],
    ['table marker-looking prose is preserved', 'PAPERDESK_LITERAL_PIPE\n\n| A | B |\n|---|---|\n| code | `x|y` |'],
    ['unescaped absolute values retain the complete original row', '| Test | Action | Pass |\n|---|---|---|\n| T4 | train | 最终 |w−2|≤1e-6、|b−1|≤1e-6、J≤1e-10 |'],
    ['extra ordinary cells retain the complete original row', '| A | B |\n|---|---|\n| one | two | three | four |\n| valid | row |'],
  ]
  if (process.argv[2]) examples.push(['original reported answer', await readFile(process.argv[2], 'utf8')])
  for (const [label, markdown] of examples) {
    check(`published render equals source: ${label}`, delivered.renderMarkdown(markdown), source.renderMarkdown(markdown))
    check(`published section preview equals source: ${label}`, delivered.renderMarkdownSectioned(markdown), source.renderMarkdownSectioned(markdown))
    check(`published outline equals source: ${label}`, JSON.stringify(delivered.noteOutline(markdown)), JSON.stringify(source.noteOutline(markdown)))
  }
  const cardCases = [
    ['atx title', 'Card title', '# Card title\n\nBody (p.1).', 'Body (p.1).'],
    ['formatted title', 'Card title', '## **Card** title\n\nBody', 'Body'],
    ['setext title', 'Card title', 'Card title\n==========\n\nBody', 'Body'],
    ['paragraph title', 'Card title', 'Card title\n\nBody', 'Body'],
    ['different heading', 'Card title', '# Different\n\nBody', '# Different\n\nBody'],
    ['long paragraph', 'Card title', 'Card title with an explanation.', 'Card title with an explanation.'],
    ['code is not a title', 'Card title', '```text\nCard title\n```', '```text\nCard title\n```'],
    ['inline code is not a title', 'Card title', '`Card title`', '`Card title`'],
    ['linked heading keeps its destination', 'Card title', '# [Card title](https://example.org)', '# [Card title](https://example.org)'],
    ['quote is not a title', 'Card title', '> Card title', '> Card title'],
    ['later heading retained', 'Card title', 'Introduction\n\n## Card title', 'Introduction\n\n## Card title'],
    ['formula retained', 'Card title', '# Card title\n\n$x>1$ and `code`', '$x>1$ and `code`'],
    ['multiline paragraph retained', 'Card title', 'Card title\nAdditional explanation', 'Card title\nAdditional explanation'],
    ['empty title', '', '# Card title\n', '# Card title'],
  ]
  for (const [name, title, body, expected] of cardCases) {
    check(`card display: ${name}`, delivered.cardBodyForDisplay(title, body).trim(), expected.trim())
    check(`published card display equals source: ${name}`, delivered.cardBodyForDisplay(title, body), source.cardBodyForDisplay(title, body))
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
  const pipeTable = render('| Metric | Definition | Source |\n|---|---|---|\n| error | `max_i |ŷ_i − y_i|` | proposed |\n| params | `max(|w−2|, |b−1|)` | proposed |')
  check('literal code pipes do not manufacture extra table cells', (pipeTable.match(/<td\b/g) ?? []).length, 6)
  check('the full reported error expression remains in one code cell', pipeTable.includes('<code>max_i |ŷ_i − y_i|</code>'), true)
  check('multiple absolute values stay in the same code cell', pipeTable.includes('<code>max(|w−2|, |b−1|)</code>'), true)
  const mathTable = render('| Value | Formula |\n|---|---|\n| abs | $|x|$ |\n| norm | $\\|x\\|$ |')
  check('math bars preserve the exact original TeX annotation', mathTable.includes('encoding="application/x-tex">\\|x\\|</annotation>'), true)
  check('math inside tables is typeset with stable column count', [(mathTable.match(/<math\b/g) ?? []).length, (mathTable.match(/<td\b/g) ?? []).length], [2, 4])
  check('existing escaped GFM code pipes keep their established display', render('| A | B |\n|---|---|\n| `x\\|y` | c |').includes('<code>x|y</code>'), true)
  check('pipes inside header code do not invalidate an otherwise valid table', (render('| `a|b` | B |\n|---|---|\n| c | d |').match(/<th\b/g) ?? []).length, 2)
  check('nested quoted tables use the same literal-pipe rules', render('> | A | B |\n> |---|---|\n> | code | `x|y` |').includes('<code>x|y</code>'), true)
  check('fenced examples are never reinterpreted as real tables', render('```md\n| A | B |\n|---|---|\n| code | `x|y` |\n```').includes('<table>'), false)
  check('table protection never leaks markers or edits prose', render('PAPERDESK_LITERAL_PIPE\n\n| A | B |\n|---|---|\n| code | `x|y` |').includes('PAPERDESK_LITERAL_PIPE</p>'), true)
  const overflowTable = render('| Test | Action | Pass |\n|---|---|---|\n| T4 | train | 最终 |w−2|≤1e-6、|b−1|≤1e-6、J≤1e-10 |\n| T5 | check | tolerance (1+|J_t|) |')
  check('ambiguous table rows retain the entire original condition', overflowTable.includes('|w−2|≤1e-6、|b−1|≤1e-6、J≤1e-10'), true)
  check('ambiguous rows are labelled as source rather than silently truncated', (overflowTable.match(/class="pd-md-table-overflow"/g) ?? []).length, 2)
  check('fallback rows span only the declared columns', (overflowTable.match(/colspan="3"/g) ?? []).length, 2)
  check('malformed row fallback does not expose raw HTML', /<script>/.test(render('| A | B |\n|---|---|\n| x | y | <script>bad</script> |')), false)
  check('escaped delimiters do not trigger overflow fallback', render('| A | B |\n|---|---|\n| x\\|y | z |').includes('pd-md-table-overflow'), false)
  check('nonterminal optional delimiters remain ordinary GFM rows', render('A | B\n---|---\nx | y').includes('pd-md-table-overflow'), false)
  console.log(`${checks} delivered Markdown checks passed`)
} finally { await rm(root, { recursive: true, force: true }) }
