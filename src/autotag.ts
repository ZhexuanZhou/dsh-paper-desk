/**
 * Deterministic topic tagging for newly imported papers.
 *
 * The tags are derived only from the title / abstract / keywords already in the
 * library (no network and no LLM call). A small canonical taxonomy keeps tags
 * consistent across the library; explicit tags supplied by the caller always
 * win and are never overwritten.
 */

export interface AutoTagInput {
  title: string
  abstract: string
  keywords?: readonly string[]
  venue?: string
}

/** Input available to a host-side tagger (LLM or heuristic). */
export interface AutoTagContext extends AutoTagInput {
  /** Absolute PDF path; layered taggers may read the introduction from it. */
  pdfAbs: string
}

/** Generates tags for a newly imported paper. Must not throw. */
export type AutoTagFn = (input: AutoTagContext) => Promise<readonly string[]>

interface TagRule {
  tag: string
  patterns: readonly RegExp[]
}

/** Canonical topic vocabulary. Keep tags short, lowercase and hyphenated. */
const RULES: readonly TagRule[] = [
  { tag: 'diffusion-language-model', patterns: [/diffusion\s+language\s+models?/i, /diffusion\s+LM/i, /扩散语言模型/] },
  { tag: 'discrete-diffusion', patterns: [/discrete\s+diffusion/i, /discrete\s+denoising/i, /离散扩散/] },
  { tag: 'diffusion-model', patterns: [/\bdiffusion\b/i, /denoising\s+score/i, /score[- ]based/i, /扩散模型?/] },
  { tag: 'flow-matching', patterns: [/flow[\s-]+matching/i, /velocity\s+field/i, /rectified\s+flow/i, /流匹配/] },
  { tag: 'language-model', patterns: [/\blanguage\s+models?\b/i, /\bLLMs?\b/i, /language\s+modeling/i, /语言模型/] },
  { tag: 'generative-modeling', patterns: [/generative\s+model(?:ing)?/i, /\bgenerative\b/i, /生成模型/] },
  { tag: 'text-generation', patterns: [/text\s+generation/i, /language\s+generation/i, /文本生成/] },
  { tag: 'multimodal', patterns: [/multimodal/i, /vision[\s-]+language/i, /image[\s-]+text/i, /多模态/] },
  { tag: 'computer-vision', patterns: [/computer\s+vision/i, /image\s+generation/i, /imagenet/i, /图像生成/, /计算机视觉/] },
  { tag: 'reinforcement-learning', patterns: [/reinforcement\s+learning/i, /\bRLHF\b/i, /policy\s+optimization/i, /强化学习/] },
  { tag: 'representation-learning', patterns: [/representation\s+learning/i, /self[\s-]+supervised/i, /\bembeddings?\b/i, /表征学习/] },
  { tag: 'transformer', patterns: [/\btransformer(?:s)?\b/i] },
  { tag: 'graph-neural-network', patterns: [/graph\s+neural/i, /\bGNNs?\b/i, /图神经网络/] },
  { tag: 'optimization', patterns: [/\boptimization\b/i, /\boptimizers?\b/i, /优化/] },
  { tag: 'efficient-inference', patterns: [/efficien(?:t|cy)/i, /compression/i, /quantization/i, /distillation/i, /高效推理/] },
  { tag: 'interpretability', patterns: [/interpretab/i, /explainab/i, /可解释/] },
  { tag: 'robustness', patterns: [/robust/i, /adversarial/i, /鲁棒/] },
  { tag: 'causal-inference', patterns: [/causal\s+inference/i, /causality/i, /因果/] },
  { tag: 'speech', patterns: [/speech/i, /\baudio\b/i, /语音/] },
  { tag: 'protein', patterns: [/protein/i, /molecule/i, /drug\s+discovery/i, /蛋白质/] },
  { tag: 'time-series', patterns: [/time[\s-]+series/i, /temporal\s+modeling/i, /时间序列/] },
]

const MAX_TAGS = 5
const MAX_TAG_LENGTH = 32

function countMatches(text: string, pattern: RegExp): number {
  if (text.length === 0) return 0
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  let count = 0
  let match: RegExpExecArray | null
  while ((match = global.exec(text)) !== null) {
    count += 1
    if (count >= 4) break
    if (match[0].length === 0) global.lastIndex += 1
  }
  return count
}

/** Build 3–5 stable tags from a paper's title and abstract. */
export function autoTags(input: AutoTagInput): string[] {
  const title = input.title.trim()
  const abstract = input.abstract.trim()
  if (title === '' && abstract === '') return []
  const keywords = (input.keywords ?? []).join(' ')
  const venue = (input.venue ?? '').trim()

  const scored: Array<{ tag: string; score: number }> = []
  for (const rule of RULES) {
    let score = 0
    for (const pattern of rule.patterns) {
      score += countMatches(title, pattern) * 3
      score += countMatches(keywords, pattern) * 4
      score += countMatches(venue, pattern) * 2
      score += countMatches(abstract, pattern)
    }
    // One incidental mention in the abstract is usually an application or a
    // dataset name, not the paper's topic; require either a title/keyword hit
    // or at least two abstract mentions.
    if (score >= 2) scored.push({ tag: rule.tag, score })
  }

  scored.sort((left, right) => right.score - left.score || left.tag.localeCompare(right.tag))
  const out: string[] = []
  for (const item of scored) {
    if (out.length >= MAX_TAGS) break
    if (item.tag.length > MAX_TAG_LENGTH) continue
    if (!out.includes(item.tag)) out.push(item.tag)
  }
  return out
}
