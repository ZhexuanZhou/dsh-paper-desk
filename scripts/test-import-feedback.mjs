import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
const require = createRequire(import.meta.url)
const temp = await mkdtemp(path.join(os.tmpdir(), 'paper-import-feedback-'))
let checks = 0
const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks++; console.log(`ok ${name}`) }
try {
  const file = path.join(temp, 'feedback.mjs')
  await build({ stdin: { contents: "export {ImportDialog} from './client/ImportDialog.tsx'; export {I18nProvider} from './client/i18n.ts'; export {visualCaretPosition, moveSelectionCaret, verticalTextTarget, textCaretOffsets} from './client/pdfVisualSelection.ts'; export {DEFAULT_KEYMAP,matchesBinding} from './client/keymap.ts'; export {ReaderTags} from './client/ReaderTags.tsx'; export {ReaderStatus} from './client/ReaderStatus.tsx'; export {pdfAnchorScrollDelta} from './client/pdfViewport.ts'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', outfile: file,
    plugins: [{ name: 'shared-react', setup(b) { b.onResolve({ filter: /^react(?:\/.*)?$/ }, ({path: specifier}) => ({ path: require.resolve(specifier), external: true })) } }] })
  const { ImportDialog, I18nProvider, visualCaretPosition, moveSelectionCaret, verticalTextTarget, textCaretOffsets, DEFAULT_KEYMAP, matchesBinding, ReaderTags, ReaderStatus, pdfAnchorScrollDelta } = await import(pathToFileURL(file))
  const defaults = { open: true, importing: false, urlBusy: false, url: '', error: null, results: [], onRetry: () => {}, onRetryFailed: () => {}, onUrlChange: () => {}, onUrlSubmit: () => {}, onPickFiles: () => {}, onFiles: () => {}, onClose: () => {} }
  const render = (props = {}, lang = 'en') => renderToStaticMarkup(createElement(I18nProvider, {lang}, createElement(ImportDialog, { ...defaults, ...props })))
  const footer = html => html.slice(html.indexOf('class="pd-modal-foot"'))
  check('idle footer explains how to start rather than claiming processing', footer(render()).includes('Choose local PDFs'), true)
  const running = footer(render({urlBusy: true, results: [{url:'https://example.org/a.pdf', state:'running'}]}))
  check('running import has a progress message and busy indicator', running.includes('Downloading and importing') && running.includes('data-busy="true"'), true)
  const successProps = {results:[{url:'https://example.org/a.pdf',title:'Paper A',state:'success'},{url:'https://example.org/b.pdf',state:'duplicate'}]}
  const success = footer(render(successProps))
  check('completed batch includes duplicates as resolved records', success.includes('Added or already in library · 2/2'), true)
  check('completed state never says importing or model processing', success.includes('Downloading and importing') || success.includes('model receives'), false)
  check('finished footer tells the user processing is over', success.includes('Processing has finished'), true)
  const partial = footer(render({results:[{url:'https://example.org/a.pdf',state:'success'},{url:'https://example.org/b.pdf',state:'error',error:'not found'}]}))
  check('partial failure is not presented as full success', partial.includes('1/2') && partial.includes('Some items failed'), true)
  check('metadata disclosure is available outside the status footer', render().includes('Metadata enrichment &amp; data use') && !footer(render()).includes('model receives'), true)
  check('Chinese completion copy is also explicit', footer(render(successProps, 'zh')).includes('本次处理已结束'), true)
  const bounds = (left, top, width, height) => ({ left, top, width, height, right:left+width, bottom:top+height })
  const root = bounds(50, 100, 600, 800), viewport = bounds(50, 180, 600, 720)
  check('caret uses actual rendered line height and viewer coordinates', visualCaretPosition(bounds(150, 250, 0, 18), root, viewport), {left:100,top:150,width:2,height:18})
  check('zoomed caret tracks rendered text without a fixed PDF scale', visualCaretPosition(bounds(250, 400, 0, 36), root, viewport), {left:200,top:300,width:2,height:36})
  check('rotated horizontal text uses a horizontal caret', visualCaretPosition(bounds(250, 400, 36, 0), root, viewport), {left:200,top:300,width:36,height:2})
  check('offscreen endpoint is hidden instead of clamped onto another line', visualCaretPosition(bounds(250, 950, 0, 18), root, viewport), null)
  check('empty DOM rectangles do not invent a caret', visualCaretPosition(bounds(0, 0, 0, 0), root, viewport), null)
  check('invalid coordinates do not place a marker', visualCaretPosition(bounds(NaN, 250, 0, 18), root, viewport), null)
  for (const [key, action, granularity, direction] of [['h','moveCaretLeft','character','backward'],['l','moveCaretRight','character','forward'],['j','moveCaretDown','line','forward'],['k','moveCaretUp','line','backward']]) {
    const input = { key:key.toUpperCase(), shiftKey:true,ctrlKey:false,metaKey:false,altKey:false }
    check(`Shift+${key} matches the configured caret movement`, matchesBinding(input, DEFAULT_KEYMAP[action]), true)
    check(`plain ${key} never triggers Shift caret movement`, matchesBinding({...input,key,shiftKey:false},DEFAULT_KEYMAP[action]), false)
    if (granularity === 'line') continue // PDF lines use rendered geometry, tested below.
    const operations=[]
    const node={nodeType:3}
    const selection={focusNode:node,focusOffset:8,isCollapsed:false,collapse:(...args)=>operations.push(['collapse',...args]),modify:(...args)=>operations.push(args)}
    check(`Shift+${key} repositions from the active end without extending`,moveSelectionCaret(selection,granularity,direction),true)
    check(`Shift+${key} collapses the old range before moving`,operations,[['collapse',node,8],['move',direction,granularity]])
  }
  check('unsupported browser selection movement reports no change',moveSelectionCaret({focusNode:{},focusOffset:0,isCollapsed:true,collapse(){}},'character','forward'),false)
  check("vertical caret offsets never split emoji, combining marks or surrogate pairs",textCaretOffsets("A👩‍🔬é中"),[0,1,6,8,9])
  const caret = bounds(100,100,0,16), before = bounds(50,76,200,16), after = bounds(50,124,200,16)
  check('PDF geometry moves down to the next rendered line',verticalTextTarget(caret,[before,after],100,'forward'),after)
  check('PDF geometry moves up to the previous rendered line',verticalTextTarget(caret,[before,after],100,'backward'),before)
  const otherColumn = bounds(400,120,200,16)
  check('slightly closer text in the other column does not steal vertical movement',verticalTextTarget(caret,[otherColumn,after],100,'forward'),after)
  const superscript = bounds(100,97,8,8)
  check('a raised fragment is not mistaken for the preceding line',verticalTextTarget(caret,[superscript,before],100,'backward'),before)
  const leftFragment = bounds(40,124,30,16), rightFragment = bounds(80,124,120,16)
  check('fragmented lines choose the text containing the preferred x',verticalTextTarget(caret,[leftFragment,rightFragment],100,'forward'),rightFragment)
  check('line boundary returns no target rather than jumping backward',verticalTextTarget(caret,[before],100,'forward'),null)
  const short = bounds(50,124,25,16)
  check('short lines remain reachable at a preferred x beyond their end',verticalTextTarget(caret,[short],100,'forward'),short)
  for(const scale of [.51,1.62,2]) {
    const scaled = r => bounds(r.left*scale,r.top*scale,r.width*scale,r.height*scale)
    const target = scaled(after)
    check(`vertical movement preserves the line at ${scale} scale`,verticalTextTarget(scaled(caret),[scaled(otherColumn),target],100*scale,'forward'),target)
  }
  const tags = renderToStaticMarkup(createElement(ReaderTags, { tags: ['image-generation','vision-understanding','multimodal','few-shot','generalist-models'] }))
  check('five tags expose a named +3 disclosure', tags.includes('>+3</button>') && tags.includes('展开全部 5 个标签'), true)
  check('zero tags do not create an empty header row', renderToStaticMarkup(createElement(ReaderTags,{tags:[]})), '')
  const status = renderToStaticMarkup(createElement(ReaderStatus,{status:'reading',disabled:false,onChange:async()=>{}}))
  check('reading status remains an accessible clickable menu', status.includes('aria-haspopup="menu"') && status.includes('在读'), true)
  check('status trigger does not render a chevron or fallback more icon', status.includes('⌄') || status.includes('<svg'), false)
  check('unchanged page layout preserves the existing reading position',pdfAnchorScrollDelta(-100,100,1000,.2),0)
  check('shrinking a page scrolls back to the same fractional text position',pdfAnchorScrollDelta(-400,100,500,.2),-400)
  check('growing a page scrolls forward to retain the same text position',pdfAnchorScrollDelta(500,100,2000,.2),800)
  for(const [top,height,fraction] of [[-350,500,.2],[900,2000,.7],[250,800,0]]){
    const viewportTop=100,delta=pdfAnchorScrollDelta(top,viewportTop,height,fraction)
    check(`zoom anchor invariance for pageTop=${top}`,Math.abs((viewportTop-(top-delta))/height-fraction)<1e-10,true)
  }
  console.log(`${checks} import feedback and visual caret checks passed`)
} finally { await rm(temp, { recursive: true, force: true }) }
