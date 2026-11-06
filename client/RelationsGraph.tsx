/**
 * Paper relation graph overlay (library level).
 *
 * A self-contained container component: it owns its tiny deterministic force
 * layout, its CSS string (`relationsCss`, prefix `pd-rel-`, host theme tokens
 * only) and its zh/en dictionary fragment (`relationsDict`). The Lead merges
 * both fragments into `styles.ts` / `i18n.ts`; the panel renders this component
 * directly.
 *
 * Contract (DESIGN-FEATURES.md §3 + §6.2):
 * - fetches papers + relations through `client/api.ts` when it opens,
 *   never throws, and keeps loading / error / empty states,
 * - force-directed SVG graph: nodes are papers (radius by degree), edges are
 *   typed relations coloured per RelationKind with a legend,
 * - interactions: drag nodes, wheel zoom, background pan, hover neighbours,
 *   node click → detail card (open paper / add relation), edge click → popover
 *   (kind / label / note + delete with confirm),
 * - tabs Graph / List, list rows locate an edge in the graph and can delete it,
 * - add-relation modal with searchable from/to pickers, kind, label, note and
 *   inline validation (self / duplicate / missing),
 * - focus mode (`focusPaperId`): ego-network highlight + 「查看全图」.
 *
 * Only imports: react, ./api.js, ../src/types.js.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from 'react'
import type { NewRelation, PaperRelation, PaperSummary, RelationKind } from '../src/types.js'
import { api } from './api.js'

export type Lang = 'zh' | 'en'

export const RELATION_KINDS: readonly RelationKind[] = [
  'cites',
  'related',
  'method',
  'contrast',
  'same-topic',
  'custom',
]

export interface RelationsGraphProps {
  open: boolean
  focusPaperId?: string | null
  lang: Lang
  onClose: () => void
  onOpenPaper: (paperId: string) => void
}

/* ── dictionary fragment (merged into i18n.ts by the Lead) ─────────────── */

const zhRelations: Record<string, string> = {
  'relations.title': '论文关系图谱',
  'relations.subtitle': '{papers} 篇论文 · {relations} 条关联',
  'relations.loading': '正在加载关系…',
  'relations.loadFailed': '加载关系图谱失败',
  'relations.retry': '重试',
  'relations.refresh': '刷新',
  'relations.close': '关闭',
  'relations.empty': '还没有建立任何论文关联',
  'relations.empty.desc':
    '关联有两个来源：在这里手动添加，或在「论文对比」报告末尾的关联建议中点击「加入图谱」。导入论文不会自动建立关联。',
  'relations.empty.noPapers': '论文库还是空的',
  'relations.empty.noPapersDesc': '先导入论文，再在图谱里建立它们之间的关联。',
  'relations.tab.graph': '图谱',
  'relations.tab.list': '列表',
  'relations.add': '添加关联',
  'relations.legend': '关系类型',
  'relations.kind.cites': '引用',
  'relations.kind.related': '相关',
  'relations.kind.method': '方法',
  'relations.kind.contrast': '对比',
  'relations.kind.same-topic': '同主题',
  'relations.kind.custom': '自定义',
  'relations.hint': '拖动节点 · 滚轮缩放 · 拖动空白处平移',
  'relations.zoomIn': '放大',
  'relations.zoomOut': '缩小',
  'relations.zoomReset': '重置视图',
  'relations.focus.label': '当前论文：{title}',
  'relations.focus.showAll': '查看全图',
  'relations.focus.refocus': '聚焦当前论文',
  'relations.truncated': '节点较多，图谱只显示关联最多的 {n} 篇论文；列表仍包含全部关联。',
  'relations.detail.none': '点击一个节点查看论文详情，点击连线查看关联详情。',
  'relations.detail.venue': '期刊 / 会议',
  'relations.detail.year': '年份',
  'relations.detail.authors': '作者',
  'relations.detail.count': '关联数',
  'relations.detail.relations': '{n} 条关联',
  'relations.detail.open': '打开论文',
  'relations.detail.add': '添加关联',
  'relations.edge.title': '关联详情',
  'relations.edge.label': '标签',
  'relations.edge.note': '备注',
  'relations.edge.source': '来源',
  'relations.edge.source.user': '手动创建',
  'relations.edge.source.agent': '来自对比建议',
  'relations.edge.delete': '删除关联',
  'relations.edge.deleteConfirm': '确定删除这条关联？',
  'relations.edge.deleteYes': '确认删除',
  'relations.edge.deleteNo': '取消',
  'relations.none': '未填写',
  'relations.list.hint': '点击一行在图谱中定位；删除只影响关联，不会删除论文。',
  'relations.list.label': '标签',
  'relations.list.note': '备注',
  'relations.list.delete': '删除',
  'relations.list.deleteConfirm': '删除这条关联？',
  'relations.list.empty': '还没有关联',
  'relations.form.title': '添加论文关联',
  'relations.form.desc': '为两篇论文建立一条带类型的关系；同一对论文可以有多条不同类型的关系。',
  'relations.form.from': '论文 A',
  'relations.form.to': '论文 B',
  'relations.form.search': '搜索标题或作者…',
  'relations.form.noMatch': '没有匹配的论文',
  'relations.form.notSelected': '未选择',
  'relations.form.clear': '清除选择',
  'relations.form.narrow': '输入关键词缩小范围（共 {n} 篇）',
  'relations.form.kind': '关系类型',
  'relations.form.label': '标签（可选）',
  'relations.form.labelPlaceholder': '例如：同一基准数据集',
  'relations.form.note': '备注（可选）',
  'relations.form.notePlaceholder': '补充说明这条关系…',
  'relations.form.submit': '添加',
  'relations.form.saving': '正在添加…',
  'relations.form.cancel': '取消',
  'relations.form.requiredFrom': '请选择论文 A',
  'relations.form.requiredTo': '请选择论文 B',
  'relations.form.self': '不能把一篇论文关联到它自己',
  'relations.form.duplicate': '这两篇论文之间已经有同类型的关联',
  'relations.form.labelTooLong': '标签最多 80 个字符',
  'relations.form.noteTooLong': '备注最多 1000 个字符',
  'relations.form.failed': '添加关联失败',
  'relations.deleteFailed': '删除关联失败',
  'relations.aria.graph': '论文关系图画布',
  'relations.aria.legend': '关系类型图例',
  'relations.aria.node': '{title}，{n} 条关联',
  'relations.aria.edge': '{from} ↔ {to}：{kind}',
  'relations.aria.tabs': '图谱视图切换',
  'relations.aria.zoom': '缩放控制',
  'relations.aria.pickerFrom': '选择论文 A',
  'relations.aria.pickerTo': '选择论文 B',
  'relations.dismiss': '关闭提示',
}

const enRelations: Record<string, string> = {
  'relations.title': 'Paper relation graph',
  'relations.subtitle': '{papers} papers · {relations} relations',
  'relations.loading': 'Loading relations…',
  'relations.loadFailed': 'Failed to load the relation graph',
  'relations.retry': 'Retry',
  'relations.refresh': 'Refresh',
  'relations.close': 'Close',
  'relations.empty': 'No paper relations yet',
  'relations.empty.desc':
    'Relations have two sources: add them manually here, or use “Add to graph” on the suggestions at the end of a paper comparison report. Importing papers never creates relations automatically.',
  'relations.empty.noPapers': 'Your library is empty',
  'relations.empty.noPapersDesc': 'Import papers first, then connect them in the graph.',
  'relations.tab.graph': 'Graph',
  'relations.tab.list': 'List',
  'relations.add': 'Add relation',
  'relations.legend': 'Relation types',
  'relations.kind.cites': 'Cites',
  'relations.kind.related': 'Related',
  'relations.kind.method': 'Method',
  'relations.kind.contrast': 'Contrast',
  'relations.kind.same-topic': 'Same topic',
  'relations.kind.custom': 'Custom',
  'relations.hint': 'Drag nodes · wheel to zoom · drag the background to pan',
  'relations.zoomIn': 'Zoom in',
  'relations.zoomOut': 'Zoom out',
  'relations.zoomReset': 'Reset view',
  'relations.focus.label': 'Current paper: {title}',
  'relations.focus.showAll': 'Show full graph',
  'relations.focus.refocus': 'Focus current paper',
  'relations.truncated': 'Too many papers: showing the {n} most connected. The list still includes every relation.',
  'relations.detail.none': 'Click a node for paper details, or an edge for relation details.',
  'relations.detail.venue': 'Venue',
  'relations.detail.year': 'Year',
  'relations.detail.authors': 'Authors',
  'relations.detail.count': 'Relations',
  'relations.detail.relations': '{n} relations',
  'relations.detail.open': 'Open paper',
  'relations.detail.add': 'Add relation',
  'relations.edge.title': 'Relation details',
  'relations.edge.label': 'Label',
  'relations.edge.note': 'Note',
  'relations.edge.source': 'Source',
  'relations.edge.source.user': 'Created manually',
  'relations.edge.source.agent': 'From a comparison suggestion',
  'relations.edge.delete': 'Delete relation',
  'relations.edge.deleteConfirm': 'Delete this relation?',
  'relations.edge.deleteYes': 'Delete',
  'relations.edge.deleteNo': 'Cancel',
  'relations.none': 'Not set',
  'relations.list.hint': 'Click a row to locate it in the graph; deleting only removes the relation, never the papers.',
  'relations.list.label': 'Label',
  'relations.list.note': 'Note',
  'relations.list.delete': 'Delete',
  'relations.list.deleteConfirm': 'Delete this relation?',
  'relations.list.empty': 'No relations to list',
  'relations.form.title': 'Add paper relation',
  'relations.form.desc':
    'Create one typed relation between two papers; the same pair can have several relations of different kinds.',
  'relations.form.from': 'Paper A',
  'relations.form.to': 'Paper B',
  'relations.form.search': 'Search title or author…',
  'relations.form.noMatch': 'No matching papers',
  'relations.form.notSelected': 'Nothing selected',
  'relations.form.clear': 'Clear selection',
  'relations.form.narrow': 'Type to narrow down ({n} papers)',
  'relations.form.kind': 'Relation kind',
  'relations.form.label': 'Label (optional)',
  'relations.form.labelPlaceholder': 'e.g. shared benchmark',
  'relations.form.note': 'Note (optional)',
  'relations.form.notePlaceholder': 'Add context about this relation…',
  'relations.form.submit': 'Add',
  'relations.form.saving': 'Adding…',
  'relations.form.cancel': 'Cancel',
  'relations.form.requiredFrom': 'Pick paper A',
  'relations.form.requiredTo': 'Pick paper B',
  'relations.form.self': 'A paper cannot relate to itself',
  'relations.form.duplicate': 'These papers already have a relation of this kind',
  'relations.form.labelTooLong': 'Label must be at most 80 characters',
  'relations.form.noteTooLong': 'Note must be at most 1000 characters',
  'relations.form.failed': 'Failed to add the relation',
  'relations.deleteFailed': 'Failed to delete the relation',
  'relations.aria.graph': 'Paper relation graph canvas',
  'relations.aria.legend': 'Relation kind legend',
  'relations.aria.node': '{title}, {n} relations',
  'relations.aria.edge': '{from} ↔ {to}: {kind}',
  'relations.aria.tabs': 'Graph view tabs',
  'relations.aria.zoom': 'Zoom controls',
  'relations.aria.pickerFrom': 'Choose paper A',
  'relations.aria.pickerTo': 'Choose paper B',
  'relations.dismiss': 'Dismiss message',
}

export const relationsDict: Record<Lang, Record<string, string>> = {
  zh: zhRelations,
  en: enRelations,
}

/* ── CSS fragment (merged into styles.ts by the Lead) ──────────────────── */

const FG = 'var(--dsw-alias-label-primary)'
const FG_2 = 'var(--dsw-alias-label-secondary)'
const BG = 'var(--dsw-alias-bg-base)'
const L1 = 'var(--dsw-alias-bg-layer-1)'
const L2 = 'var(--dsw-alias-bg-layer-2)'
const OVERLAY = 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2))'
const B1 = 'var(--dsw-alias-border-l1)'
const B2 = 'var(--dsw-alias-border-l2)'
const B4 = 'var(--dsw-alias-border-l4, var(--dsw-alias-border-l2))'
const BRAND = 'var(--dsw-alias-brand-primary)'
const OK = 'var(--dsw-alias-state-success-primary)'
const WARN = 'var(--dsw-alias-state-warn-primary)'
const ERR = 'var(--dsw-alias-state-error-primary)'
const HOVER = 'var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent))'
const ACTIVE = 'var(--dsw-alias-interactive-bg-active, color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent))'
const SHADOW = 'var(--dsw-shadow-lv1, 0 10px 30px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent))'
const MASK = 'var(--dsw-alias-bg-mask-1, color-mix(in srgb, var(--dsw-alias-label-primary) 26%, transparent))'
const PRIMARY_FILL = 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))'
const PRIMARY_FG = 'var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-base))'
const SANS = 'var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif)'
const RING = `0 0 0 3px color-mix(in srgb, ${BRAND} 22%, transparent)`

export const relationsCss = `
/* ── overlay shell ─────────────────────────────────────────────────────── */
.pd-rel-overlay {
  position: absolute;
  inset: 0;
  z-index: 82;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  padding: clamp(8px, 1.2cqi, 16px);
  background: ${MASK};
  backdrop-filter: blur(1.5px);
}
.pd-rel-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid ${B4};
  border-radius: 14px;
  background: ${OVERLAY};
  box-shadow: ${SHADOW};
  color: ${FG};
  font-family: ${SANS};
  font-size: 13px;
  line-height: 1.5;
  outline: none;
  -webkit-font-smoothing: antialiased;
}
.pd-rel-panel *,
.pd-rel-panel *::before,
.pd-rel-panel *::after { box-sizing: border-box; }
.pd-rel-panel :focus-visible { outline: 2px solid ${BRAND}; outline-offset: 1px; border-radius: 4px; }
.pd-rel-panel ::selection { background: color-mix(in srgb, ${BRAND} 28%, transparent); }

/* ── header ────────────────────────────────────────────────────────────── */
.pd-rel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  padding: 11px 14px;
  border-bottom: 1px solid ${B1};
  background: color-mix(in srgb, ${L1} 72%, transparent);
}
.pd-rel-head-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.pd-rel-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border-radius: 9px;
  color: ${BRAND};
  background: color-mix(in srgb, ${BRAND} 12%, transparent);
}
.pd-rel-head-text { display: flex; flex-direction: column; min-width: 0; }
.pd-rel-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.25; white-space: nowrap; }
.pd-rel-sub {
  color: ${FG_2};
  font-size: 11.5px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pd-rel-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  padding: 2px;
  border: 1px solid ${B1};
  border-radius: 9px;
  background: ${L2};
}
.pd-rel-tab {
  padding: 4px 13px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: ${FG_2};
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.35;
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.pd-rel-tab:hover { color: ${FG}; }
.pd-rel-tab[data-on="true"] { background: ${OVERLAY}; color: ${FG}; box-shadow: 0 1px 3px color-mix(in srgb, ${FG} 14%, transparent); }
.pd-rel-head-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-left: auto; }

/* ── buttons / inputs ──────────────────────────────────────────────────── */
.pd-rel-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 30px;
  padding: 5px 11px;
  border: 1px solid ${B1};
  border-radius: 8px;
  background: ${L1};
  color: ${FG};
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.pd-rel-btn:hover:not(:disabled) { background: ${HOVER}; }
.pd-rel-btn:active:not(:disabled) { background: ${ACTIVE}; }
.pd-rel-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pd-rel-btn-primary { border-color: transparent; background: ${PRIMARY_FILL}; color: ${PRIMARY_FG}; }
.pd-rel-btn-primary:hover:not(:disabled) { background: color-mix(in srgb, ${PRIMARY_FILL} 88%, ${FG}); }
.pd-rel-btn-danger { border-color: color-mix(in srgb, ${ERR} 38%, ${B1}); color: ${ERR}; }
.pd-rel-btn-danger:hover:not(:disabled) { background: color-mix(in srgb, ${ERR} 10%, transparent); }
.pd-rel-btn-ghost { border-color: transparent; background: transparent; }
.pd-rel-btn-ghost:hover:not(:disabled) { background: ${HOVER}; }
.pd-rel-btn-sm { min-height: 24px; padding: 2px 8px; border-radius: 6px; font-size: 11.5px; }
.pd-rel-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  min-height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: ${FG_2};
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.pd-rel-iconbtn:hover { background: ${HOVER}; color: ${FG}; }
.pd-rel-iconbtn:disabled { opacity: 0.45; cursor: not-allowed; }

.pd-rel-input,
.pd-rel-select,
.pd-rel-textarea {
  width: 100%;
  min-width: 0;
  min-height: 30px;
  padding: 5px 9px;
  border: 1px solid ${B1};
  border-radius: 8px;
  background: ${BG};
  color: ${FG};
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.4;
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.pd-rel-input::placeholder,
.pd-rel-textarea::placeholder { color: ${FG_2}; opacity: 0.75; }
.pd-rel-input:focus,
.pd-rel-select:focus,
.pd-rel-textarea:focus { border-color: color-mix(in srgb, ${BRAND} 58%, ${B1}); box-shadow: ${RING}; }
.pd-rel-textarea { min-height: 68px; resize: vertical; }
.pd-rel-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.pd-rel-field-label { color: ${FG}; font-size: 12px; font-weight: 500; }
.pd-rel-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pd-rel-error { color: ${ERR}; font-size: 11.5px; line-height: 1.5; }
.pd-rel-error[role="alert"] { padding: 6px 9px; border: 1px solid color-mix(in srgb, ${ERR} 30%, ${B1}); border-radius: 8px; background: color-mix(in srgb, ${ERR} 7%, transparent); }

/* ── focus bar / banners ───────────────────────────────────────────────── */
.pd-rel-focus {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 7px 14px;
  border-bottom: 1px solid ${B1};
  background: color-mix(in srgb, ${BRAND} 6%, transparent);
  color: ${FG_2};
  font-size: 12px;
}
.pd-rel-focus[data-all="true"] { background: color-mix(in srgb, ${FG} 4%, transparent); }
.pd-rel-focus-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: ${BRAND}; box-shadow: 0 0 0 3px color-mix(in srgb, ${BRAND} 18%, transparent); }
.pd-rel-focus-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${FG}; }
.pd-rel-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 7px 14px;
  border-bottom: 1px solid ${B1};
  background: color-mix(in srgb, ${ERR} 7%, transparent);
  color: ${ERR};
  font-size: 12px;
  line-height: 1.5;
}
.pd-rel-banner[data-kind="info"] { background: color-mix(in srgb, ${FG} 4%, transparent); color: ${FG_2}; }
.pd-rel-banner > span { flex: 1 1 auto; min-width: 0; }
.pd-rel-banner-x {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.75;
}
.pd-rel-banner-x:hover { opacity: 1; background: ${HOVER}; }

/* ── body: main + aside ────────────────────────────────────────────────── */
.pd-rel-body { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
.pd-rel-main { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; }
.pd-rel-aside {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 0 0 272px;
  width: 272px;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  border-left: 1px solid ${B1};
  background: color-mix(in srgb, ${L1} 55%, transparent);
}
.pd-rel-aside::-webkit-scrollbar,
.pd-rel-list::-webkit-scrollbar,
.pd-rel-picker-list::-webkit-scrollbar,
.pd-rel-modal-body::-webkit-scrollbar { width: 10px; height: 10px; }
.pd-rel-aside::-webkit-scrollbar-thumb,
.pd-rel-list::-webkit-scrollbar-thumb,
.pd-rel-picker-list::-webkit-scrollbar-thumb,
.pd-rel-modal-body::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  background: color-mix(in srgb, ${FG_2} 26%, transparent);
  background-clip: content-box;
  border-radius: 999px;
}

/* ── graph stage ───────────────────────────────────────────────────────── */
.pd-rel-stage {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background-color: ${BG};
  background-image: radial-gradient(
    color-mix(in srgb, ${FG_2} 20%, transparent) 1px,
    transparent 1px
  );
  background-size: 22px 22px;
}
.pd-rel-svg {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.pd-rel-svg[data-panning="true"] { cursor: grabbing; }

/* edges */
.pd-rel-edge-group { pointer-events: none; }
.pd-rel-edge {
  fill: none;
  stroke: ${FG_2};
  stroke-width: 1.6;
  stroke-linecap: round;
  opacity: 0.72;
  transition: opacity 120ms ease, stroke-width 120ms ease;
  pointer-events: none;
}
.pd-rel-edge[data-kind="cites"] { stroke: ${BRAND}; }
.pd-rel-edge[data-kind="related"] { stroke: ${OK}; }
.pd-rel-edge[data-kind="method"] { stroke: ${WARN}; }
.pd-rel-edge[data-kind="contrast"] { stroke: ${ERR}; }
.pd-rel-edge[data-kind="same-topic"] { stroke: color-mix(in srgb, ${BRAND} 52%, ${OK} 48%); }
.pd-rel-edge[data-kind="custom"] { stroke: ${FG_2}; }
.pd-rel-edge[data-active="true"] { opacity: 1; stroke-width: 2.6; }
.pd-rel-edge[data-dim="true"] { opacity: 0.1; }
.pd-rel-edge-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 16;
  pointer-events: stroke;
  cursor: pointer;
}
.pd-rel-edge-hit:focus-visible { outline: none; }
.pd-rel-arrow-head { fill: ${BRAND}; }
.pd-rel-edge-label {
  fill: ${FG};
  font-size: 10.5px;
  font-weight: 500;
  paint-order: stroke;
  stroke: ${BG};
  stroke-width: 3px;
  stroke-linejoin: round;
  pointer-events: none;
}

/* nodes */
.pd-rel-node { cursor: grab; }
.pd-rel-node:active { cursor: grabbing; }
.pd-rel-node-circle {
  fill: color-mix(in srgb, ${L1} 88%, ${BG});
  stroke: ${FG_2};
  stroke-width: 1.4;
  transition: stroke-width 120ms ease, stroke 120ms ease, opacity 120ms ease;
}
.pd-rel-node[data-status="reading"] .pd-rel-node-circle { stroke: ${BRAND}; }
.pd-rel-node[data-status="read"] .pd-rel-node-circle { stroke: ${OK}; }
.pd-rel-node[data-status="archived"] .pd-rel-node-circle { stroke: color-mix(in srgb, ${FG_2} 70%, transparent); }
.pd-rel-node[data-selected="true"] .pd-rel-node-circle {
  fill: color-mix(in srgb, ${BRAND} 20%, ${L1});
  stroke: ${BRAND};
  stroke-width: 2.4;
}
.pd-rel-node[data-hover="true"] .pd-rel-node-circle { stroke: ${BRAND}; stroke-width: 2.2; }
.pd-rel-node[data-dim="true"] { opacity: 0.2; }
.pd-rel-node-halo { fill: color-mix(in srgb, ${BRAND} 16%, transparent); stroke: none; pointer-events: none; }
.pd-rel-node-hit { fill: transparent; stroke: none; }
.pd-rel-node-dot { fill: ${FG_2}; stroke: none; pointer-events: none; }
.pd-rel-node[data-status="reading"] .pd-rel-node-dot { fill: ${BRAND}; }
.pd-rel-node[data-status="read"] .pd-rel-node-dot { fill: ${OK}; }
.pd-rel-node[data-status="archived"] .pd-rel-node-dot { fill: ${FG_2}; opacity: 0.55; }
.pd-rel-node-label {
  fill: ${FG};
  font-size: 10.5px;
  font-weight: 500;
  paint-order: stroke;
  stroke: ${BG};
  stroke-width: 3px;
  stroke-linejoin: round;
  pointer-events: none;
}

/* zoom controls + hint */
.pd-rel-zoom {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 4px;
  border: 1px solid ${B1};
  border-radius: 10px;
  background: color-mix(in srgb, ${OVERLAY} 92%, transparent);
  box-shadow: ${SHADOW};
}
.pd-rel-zoom .pd-rel-iconbtn { width: 28px; height: 28px; min-height: 28px; font-size: 16px; font-weight: 500; color: ${FG}; }
.pd-rel-hint {
  position: absolute;
  left: 12px;
  bottom: 12px;
  max-width: calc(100% - 72px);
  padding: 3px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, ${BG} 82%, transparent);
  color: ${FG_2};
  font-size: 10.5px;
  line-height: 1.5;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── edge popover ──────────────────────────────────────────────────────── */
.pd-rel-pop {
  position: absolute;
  z-index: 8;
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: min(300px, calc(100% - 24px));
  padding: 11px 12px;
  border: 1px solid ${B4};
  border-radius: 10px;
  background: ${OVERLAY};
  box-shadow: ${SHADOW};
  color: ${FG};
  font-size: 12px;
}
.pd-rel-pop-head { display: flex; align-items: center; gap: 8px; }
.pd-rel-pop-title { flex: 1 1 auto; font-size: 12.5px; font-weight: 600; }
.pd-rel-pop-close {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: ${FG_2};
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.pd-rel-pop-close:hover { background: ${HOVER}; color: ${FG}; }
.pd-rel-pop-pair { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; color: ${FG}; font-size: 12px; font-weight: 500; line-height: 1.4; }
.pd-rel-pop-arrow { color: ${FG_2}; font-weight: 400; }
.pd-rel-kv { display: flex; flex-direction: column; gap: 1px; }
.pd-rel-kv-key { color: ${FG_2}; font-size: 10.5px; letter-spacing: 0.02em; text-transform: uppercase; }
.pd-rel-kv-val { color: ${FG}; font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.pd-rel-pop-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; padding-top: 2px; }
.pd-rel-pop-confirm {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px 9px;
  border: 1px solid color-mix(in srgb, ${ERR} 30%, ${B1});
  border-radius: 8px;
  background: color-mix(in srgb, ${ERR} 7%, transparent);
}
.pd-rel-pop-confirm-text { color: ${ERR}; font-size: 11.5px; line-height: 1.5; }
.pd-rel-pop-confirm-actions { display: flex; justify-content: flex-end; gap: 6px; }

/* ── legend / detail card ──────────────────────────────────────────────── */
.pd-rel-legend { display: flex; flex-direction: column; gap: 6px; flex: 0 0 auto; }
.pd-rel-legend-title {
  color: ${FG_2};
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.pd-rel-legend-row { display: flex; align-items: center; gap: 7px; color: ${FG_2}; font-size: 11.5px; line-height: 1.5; }
.pd-rel-legend-kind { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-rel-legend-count { margin-left: auto; color: ${FG_2}; font-variant-numeric: tabular-nums; opacity: 0.85; }
.pd-rel-swatch { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: ${FG_2}; }
.pd-rel-swatch[data-kind="cites"] { background: ${BRAND}; }
.pd-rel-swatch[data-kind="related"] { background: ${OK}; }
.pd-rel-swatch[data-kind="method"] { background: ${WARN}; }
.pd-rel-swatch[data-kind="contrast"] { background: ${ERR}; }
.pd-rel-swatch[data-kind="same-topic"] { background: color-mix(in srgb, ${BRAND} 52%, ${OK} 48%); }
.pd-rel-swatch[data-kind="custom"] { background: ${FG_2}; }

.pd-rel-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex: 0 0 auto;
  padding: 11px 12px;
  border: 1px solid ${B1};
  border-radius: 10px;
  background: ${L2};
}
.pd-rel-card-title { margin: 0; font-size: 12.5px; font-weight: 600; line-height: 1.45; word-break: break-word; }
.pd-rel-card-row { display: flex; align-items: flex-start; gap: 8px; font-size: 11px; line-height: 1.5; }
.pd-rel-card-key { flex: 0 0 76px; color: ${FG_2}; }
.pd-rel-card-val { flex: 1 1 auto; min-width: 0; color: ${FG}; word-break: break-word; }
.pd-rel-card-actions { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 2px; }
.pd-rel-card-empty { color: ${FG_2}; font-size: 11.5px; line-height: 1.55; }

/* ── loading / empty / error states ────────────────────────────────────── */
.pd-rel-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 30px 22px;
  color: ${FG_2};
  text-align: center;
}
.pd-rel-state-title { color: ${FG}; font-size: 14px; font-weight: 600; }
.pd-rel-state-desc { max-width: 460px; font-size: 12px; line-height: 1.62; }
.pd-rel-state-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 2px; }
.pd-rel-spinner {
  display: inline-block;
  width: 18px;
  height: 18px;
  border: 2px solid color-mix(in srgb, ${FG} 17%, transparent);
  border-top-color: ${BRAND};
  border-radius: 50%;
  animation: pd-rel-spin 800ms linear infinite;
}
@keyframes pd-rel-spin { to { transform: rotate(360deg); } }

/* ── list tab ──────────────────────────────────────────────────────────── */
.pd-rel-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px 20px;
}
.pd-rel-list-hint { color: ${FG_2}; font-size: 11.5px; line-height: 1.5; }
.pd-rel-list-ul { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.pd-rel-list-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid ${B1};
  border-radius: 9px;
  background: ${L1};
  transition: background 120ms ease, border-color 120ms ease;
}
.pd-rel-list-row:hover { background: ${HOVER}; }
.pd-rel-list-row[data-selected="true"] {
  border-color: color-mix(in srgb, ${BRAND} 32%, transparent);
  background: color-mix(in srgb, ${BRAND} 8%, transparent);
}
.pd-rel-list-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  text-align: left;
  cursor: pointer;
}
.pd-rel-list-titles { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 550; line-height: 1.4; }
.pd-rel-list-title { min-width: 0; word-break: break-word; }
.pd-rel-list-arrow { flex: 0 0 auto; color: ${FG_2}; font-weight: 400; }
.pd-rel-list-badges { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pd-rel-kind {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  border: 1px solid ${B1};
  border-radius: 999px;
  color: ${FG_2};
  font-size: 10.5px;
  line-height: 1.7;
  white-space: nowrap;
}
.pd-rel-list-label { color: ${FG_2}; font-size: 11px; line-height: 1.5; word-break: break-word; }
.pd-rel-list-note {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: ${FG_2};
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.pd-rel-list-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 4px; flex: 0 0 auto; max-width: 42%; }
.pd-rel-list-confirm-text { color: ${ERR}; font-size: 11px; line-height: 1.4; text-align: right; }
.pd-rel-list-empty { color: ${FG_2}; font-size: 12px; padding: 18px 4px; }

/* ── add-relation modal ────────────────────────────────────────────────── */
.pd-rel-modal-mask {
  position: absolute;
  inset: 0;
  z-index: 12;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: ${MASK};
  backdrop-filter: blur(1px);
}
.pd-rel-modal {
  display: flex;
  flex-direction: column;
  width: min(640px, 100%);
  max-height: min(92%, 780px);
  overflow: hidden;
  border: 1px solid ${B4};
  border-radius: 12px;
  background: ${OVERLAY};
  box-shadow: ${SHADOW};
}
.pd-rel-modal-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  padding: 12px 14px;
  border-bottom: 1px solid ${B1};
}
.pd-rel-modal-title { flex: 1 1 auto; margin: 0; font-size: 14px; font-weight: 600; }
.pd-rel-form { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.pd-rel-modal-body { display: flex; flex-direction: column; gap: 11px; min-height: 0; overflow: auto; padding: 13px 14px; }
.pd-rel-modal-desc { margin: 0; color: ${FG_2}; font-size: 12px; line-height: 1.6; }
.pd-rel-modal-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
  padding: 11px 14px;
  border-top: 1px solid ${B1};
}

/* searchable paper picker */
.pd-rel-picker {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px;
  border: 1px solid ${B1};
  border-radius: 9px;
  background: ${BG};
}
.pd-rel-picker-selected {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  padding: 0 3px;
  font-size: 11.5px;
  line-height: 1.4;
}
.pd-rel-picker-choice { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${FG}; font-weight: 500; }
.pd-rel-picker-placeholder { flex: 1 1 auto; color: ${FG_2}; }
.pd-rel-picker-clear {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: ${FG_2};
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.pd-rel-picker-clear:hover { background: ${HOVER}; color: ${FG}; }
.pd-rel-picker-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 136px;
  overflow: auto;
  margin-top: 3px;
  padding-top: 4px;
  border-top: 1px solid ${B1};
}
.pd-rel-picker-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: ${FG};
  font-family: inherit;
  font-size: 11.5px;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}
.pd-rel-picker-item:hover { background: ${HOVER}; }
.pd-rel-picker-item[data-selected="true"] { background: color-mix(in srgb, ${BRAND} 12%, transparent); color: ${BRAND}; }
.pd-rel-picker-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-rel-picker-year { flex: 0 0 auto; color: ${FG_2}; font-size: 10.5px; font-variant-numeric: tabular-nums; }
.pd-rel-picker-empty { padding: 4px 6px; color: ${FG_2}; font-size: 11px; line-height: 1.45; }

/* ── responsive: container queries follow the host panel width ─────────── */
@container pd (max-width: 980px) {
  .pd-rel-aside { flex-basis: 224px; width: 224px; padding: 10px; }
  .pd-rel-title { font-size: 14px; }
  .pd-rel-sub { display: none; }
}
@container pd (max-width: 760px) {
  .pd-rel-head { padding: 9px 11px; gap: 8px; }
  .pd-rel-head-actions { gap: 4px; }
  .pd-rel-body { flex-direction: column; }
  .pd-rel-main { flex: 1 1 auto; min-height: 220px; }
  .pd-rel-stage { min-height: 240px; }
  .pd-rel-aside {
    flex: 0 0 auto;
    width: auto;
    max-height: 34%;
    border-left: 0;
    border-top: 1px solid ${B1};
    padding: 10px 12px;
    overflow: auto;
  }
  .pd-rel-focus { padding: 6px 11px; }
  .pd-rel-list { padding: 10px 11px 16px; }
  .pd-rel-list-row { flex-direction: column; align-items: stretch; }
  .pd-rel-list-actions { max-width: none; justify-content: flex-end; }
  .pd-rel-field-row { grid-template-columns: 1fr; }
  .pd-rel-modal-mask { padding: 10px; }
  .pd-rel-modal { max-height: 94%; }
  .pd-rel-hint { display: none; }
  .pd-rel-zoom { right: 8px; bottom: 8px; }
  .pd-rel-pop { width: calc(100% - 16px); }
}
@media (prefers-reduced-motion: reduce) {
  .pd-rel-btn,
  .pd-rel-tab,
  .pd-rel-node-circle,
  .pd-rel-edge,
  .pd-rel-list-row { transition: none; }
  .pd-rel-spinner { animation-duration: 2.4s; }
}
`

/* ── tiny helpers ──────────────────────────────────────────────────────── */

const MAX_GRAPH_NODES = 150
const PICKER_VISIBLE = 80
const LABEL_MAX = 80
const NOTE_MAX = 1000

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (vars === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  if (typeof error === 'string' && error.length > 0) return error
  return ''
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Deterministic PRNG (mulberry32) used only for initial node placement. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shortenTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim()
  if (clean.length <= 26) return clean
  return `${clean.slice(0, 25)}…`
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`
}

/* ── force layout model ────────────────────────────────────────────────── */

interface SimNode {
  id: string
  paper: PaperSummary
  short: string
  x: number
  y: number
  vx: number
  vy: number
  fx: number
  fy: number
  degree: number
  radius: number
}

interface SimEdge {
  relation: PaperRelation
  a: SimNode
  b: SimNode
  index: number
  count: number
}

interface GraphGeometry {
  nodes: SimNode[]
  edges: SimEdge[]
  truncated: number
}

/**
 * Build the node/edge model. Nodes = library papers, capped to
 * MAX_GRAPH_NODES by degree (the focused paper is always kept). Relations
 * whose endpoints are missing from the library are ignored for the graph but
 * stay in the List tab.
 */
function buildGraph(
  papers: readonly PaperSummary[],
  relations: readonly PaperRelation[],
  width: number,
  height: number,
  previous: readonly SimNode[],
  focusPaperId: string | null,
): GraphGeometry {
  const byId = new Map(papers.map((paper) => [paper.id, paper]))
  const degree = new Map<string, number>()
  for (const relation of relations) {
    if (!byId.has(relation.from) || !byId.has(relation.to)) continue
    degree.set(relation.from, (degree.get(relation.from) ?? 0) + 1)
    degree.set(relation.to, (degree.get(relation.to) ?? 0) + 1)
  }

  const ordered = [...papers].sort((left, right) => {
    const leftDegree = degree.get(left.id) ?? 0
    const rightDegree = degree.get(right.id) ?? 0
    if (leftDegree !== rightDegree) return rightDegree - leftDegree
    return left.title.localeCompare(right.title)
  })

  let kept = ordered
  let truncated = 0
  if (ordered.length > MAX_GRAPH_NODES) {
    kept = ordered.slice(0, MAX_GRAPH_NODES)
    truncated = ordered.length - MAX_GRAPH_NODES
    if (focusPaperId !== null) {
      const focusPaper = byId.get(focusPaperId)
      if (focusPaper !== undefined && !kept.some((paper) => paper.id === focusPaperId)) {
        kept = [...kept.slice(0, MAX_GRAPH_NODES - 1), focusPaper]
      }
    }
  }

  const keptIds = new Set(kept.map((paper) => paper.id))
  const previousById = new Map(previous.map((node) => [node.id, node]))
  const centerX = width / 2
  const centerY = height / 2
  const spread = Math.max(40, Math.min(width, height) * 0.36)
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  const count = Math.max(1, kept.length)

  const nodes = kept.map((paper, index) => {
    const prior = previousById.get(paper.id)
    const nodeDegree = degree.get(paper.id) ?? 0
    const rng = mulberry32(hashString(paper.id))
    const angle = index * goldenAngle + rng() * 0.55
    const ring = Math.sqrt((index + 0.5) / count) * spread
    const seededX = centerX + Math.cos(angle) * ring + (rng() - 0.5) * 12
    const seededY = centerY + Math.sin(angle) * ring + (rng() - 0.5) * 12
    const x = clamp(prior?.x ?? seededX, 24, Math.max(25, width - 24))
    const y = clamp(prior?.y ?? seededY, 24, Math.max(25, height - 24))
    return {
      id: paper.id,
      paper,
      short: shortenTitle(paper.title),
      x,
      y,
      vx: 0,
      vy: 0,
      fx: 0,
      fy: 0,
      degree: nodeDegree,
      radius: 6 + Math.min(16, Math.sqrt(nodeDegree) * 4.4),
    } satisfies SimNode
  })

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const groups = new Map<string, PaperRelation[]>()
  for (const relation of relations) {
    if (!keptIds.has(relation.from) || !keptIds.has(relation.to)) continue
    const key = pairKey(relation.from, relation.to)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [relation])
    else group.push(relation)
  }

  const edges: SimEdge[] = []
  for (const group of groups.values()) {
    const edgeCount = group.length
    group.forEach((relation, index) => {
      const a = nodeById.get(relation.from)
      const b = nodeById.get(relation.to)
      if (a !== undefined && b !== undefined) {
        edges.push({ relation, a, b, index, count: edgeCount })
      }
    })
  }

  return { nodes, edges, truncated }
}

const REPULSION = 12000
const SPRING_LENGTH = 148
const SPRING_STRENGTH = 0.02
const CENTER_STRENGTH = 0.004
const DAMPING = 0.84
const MAX_SPEED = 14
const BOUNDS_PAD = 26
const ALPHA_MIN = 0.012

/**
 * One integration step of the tiny force simulation:
 * pairwise repulsion + spring per edge + weak centering, velocity damping and
 * a hard stage-bounds clamp. Returns the largest node speed this step so the
 * caller can stop early once the layout is still.
 */
function stepSimulation(
  nodes: readonly SimNode[],
  edges: readonly SimEdge[],
  width: number,
  height: number,
  alpha: number,
  draggedId: string | null,
): number {
  const centerX = width / 2
  const centerY = height / 2
  for (const node of nodes) {
    node.fx = 0
    node.fy = 0
  }

  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i]
    if (a === undefined) continue
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j]
      if (b === undefined) continue
      let dx = b.x - a.x
      let dy = b.y - a.y
      let distSq = dx * dx + dy * dy
      if (distSq < 1) {
        dx = 0.6
        dy = 0.6
        distSq = 1
      }
      const dist = Math.sqrt(distSq)
      const force = Math.min(REPULSION / distSq, 24)
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.fx -= fx
      a.fy -= fy
      b.fx += fx
      b.fy += fy
    }
  }

  for (const edge of edges) {
    const { a, b } = edge
    let dx = b.x - a.x
    let dy = b.y - a.y
    let dist = Math.hypot(dx, dy)
    if (dist < 0.01) {
      dx = 0.5
      dy = 0.5
      dist = Math.SQRT1_2
    }
    const force = (dist - SPRING_LENGTH) * SPRING_STRENGTH
    const fx = (dx / dist) * force
    const fy = (dy / dist) * force
    a.fx += fx
    a.fy += fy
    b.fx -= fx
    b.fy -= fy
  }

  const minX = Math.min(BOUNDS_PAD, Math.max(0, width / 2 - 1))
  const maxX = Math.max(minX + 1, width - BOUNDS_PAD)
  const minY = Math.min(BOUNDS_PAD, Math.max(0, height / 2 - 1))
  const maxY = Math.max(minY + 1, height - BOUNDS_PAD)

  let maxSpeed = 0
  for (const node of nodes) {
    node.fx += (centerX - node.x) * CENTER_STRENGTH
    node.fy += (centerY - node.y) * CENTER_STRENGTH
    if (node.id === draggedId) {
      node.vx = 0
      node.vy = 0
      continue
    }
    node.vx = (node.vx + node.fx * alpha) * DAMPING
    node.vy = (node.vy + node.fy * alpha) * DAMPING
    const speed = Math.hypot(node.vx, node.vy)
    if (speed > MAX_SPEED) {
      node.vx = (node.vx / speed) * MAX_SPEED
      node.vy = (node.vy / speed) * MAX_SPEED
    }
    node.x = clamp(node.x + node.vx, minX, maxX)
    node.y = clamp(node.y + node.vy, minY, maxY)
    if (Math.abs(node.vx) > maxSpeed) maxSpeed = Math.abs(node.vx)
    if (Math.abs(node.vy) > maxSpeed) maxSpeed = Math.abs(node.vy)
  }
  return maxSpeed
}

/** Quadratic path for one edge (parallel edges between the same pair fan out). */
function edgeGeometry(edge: SimEdge): { path: string; midX: number; midY: number } {
  const { a, b } = edge
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy) || 1
  const offset = edge.count > 1 ? (edge.index - (edge.count - 1) / 2) * 26 : 0

  if (offset === 0) {
    const ux = dx / length
    const uy = dy / length
    const startX = a.x + ux * (a.radius + 2)
    const startY = a.y + uy * (a.radius + 2)
    const endX = b.x - ux * (b.radius + 2)
    const endY = b.y - uy * (b.radius + 2)
    return {
      path: `M ${startX.toFixed(2)} ${startY.toFixed(2)} L ${endX.toFixed(2)} ${endY.toFixed(2)}`,
      midX: (startX + endX) / 2,
      midY: (startY + endY) / 2,
    }
  }

  const controlX = (a.x + b.x) / 2 - (dy / length) * offset
  const controlY = (a.y + b.y) / 2 + (dx / length) * offset
  const startDx = controlX - a.x
  const startDy = controlY - a.y
  const startLen = Math.hypot(startDx, startDy) || 1
  const endDx = b.x - controlX
  const endDy = b.y - controlY
  const endLen = Math.hypot(endDx, endDy) || 1
  const startX = a.x + (startDx / startLen) * (a.radius + 2)
  const startY = a.y + (startDy / startLen) * (a.radius + 2)
  const endX = b.x - (endDx / endLen) * (b.radius + 2)
  const endY = b.y - (endDy / endLen) * (b.radius + 2)
  return {
    path: `M ${startX.toFixed(2)} ${startY.toFixed(2)} Q ${controlX.toFixed(2)} ${controlY.toFixed(2)} ${endX.toFixed(2)} ${endY.toFixed(2)}`,
    midX: 0.25 * startX + 0.5 * controlX + 0.25 * endX,
    midY: 0.25 * startY + 0.5 * controlY + 0.25 * endY,
  }
}

interface ViewState {
  x: number
  y: number
  k: number
}

interface EdgeSelection {
  id: string
  /** Popover anchor, in stage CSS pixels. */
  x: number
  y: number
}

interface DragState {
  id: string
  pointerId: number
  lastX: number
  lastY: number
  startX: number
  startY: number
  moved: boolean
}

interface PanState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
}

type CenterRequest = { kind: 'fit' } | { kind: 'node'; id: string }

/* ── small inline icons (kept local: the component may not import icons.tsx) */

function IconGraph(): ReactElement {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true" fill="none">
      <circle cx="5" cy="5" r="2.1" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="15" cy="7" r="2.1" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="9" cy="15" r="2.1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.7 6 13 6.6M6 7.1 8.2 13M13.9 8.9 10.3 13.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function IconClose(): ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function IconRefresh(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.6V8H7.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ── searchable paper picker ───────────────────────────────────────────── */

interface PaperPickerProps {
  papers: readonly PaperSummary[]
  value: string | null
  onChange: (paperId: string | null) => void
  inputId: string
  searchPlaceholder: string
  noMatch: string
  clearLabel: string
  ariaLabel: string
  placeholder: string
  narrowLabel: (count: number) => string
  autoFocus?: boolean
}

function PaperPicker(props: PaperPickerProps): ReactElement {
  const [query, setQuery] = useState('')
  const sorted = useMemo(
    () => [...props.papers].sort((left, right) => left.title.localeCompare(right.title)),
    [props.papers],
  )
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return sorted
    return sorted.filter((paper) => {
      if (paper.title.toLowerCase().includes(needle)) return true
      if (paper.authors.some((author) => author.toLowerCase().includes(needle))) return true
      return paper.year !== null && String(paper.year).includes(needle)
    })
  }, [sorted, query])
  const selectedPaper = props.value === null ? undefined : props.papers.find((paper) => paper.id === props.value)
  const visible = filtered.slice(0, PICKER_VISIBLE)

  return (
    <div className="pd-rel-picker">
      <div className="pd-rel-picker-selected">
        {selectedPaper !== undefined ? (
          <span className="pd-rel-picker-choice" title={selectedPaper.title}>
            {selectedPaper.title}
          </span>
        ) : (
          <span className="pd-rel-picker-placeholder">{props.placeholder}</span>
        )}
        {selectedPaper !== undefined ? (
          <button
            type="button"
            className="pd-rel-picker-clear"
            aria-label={props.clearLabel}
            title={props.clearLabel}
            onClick={() => {
              props.onChange(null)
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      <input
        id={props.inputId}
        className="pd-rel-input"
        type="search"
        value={query}
        placeholder={props.searchPlaceholder}
        aria-label={props.ariaLabel}
        autoFocus={props.autoFocus === true}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="pd-rel-picker-list">
        {filtered.length === 0 ? (
          <span className="pd-rel-picker-empty">{props.noMatch}</span>
        ) : (
          <>
            {visible.map((paper) => (
              <button
                key={paper.id}
                type="button"
                className="pd-rel-picker-item"
                data-selected={paper.id === props.value ? 'true' : 'false'}
                aria-pressed={paper.id === props.value}
                onClick={() => {
                  props.onChange(paper.id)
                  setQuery('')
                }}
              >
                <span className="pd-rel-picker-title" title={paper.title}>
                  {paper.title}
                </span>
                <span className="pd-rel-picker-year">{paper.year ?? ''}</span>
              </button>
            ))}
            {filtered.length > visible.length ? (
              <span className="pd-rel-picker-empty">{props.narrowLabel(filtered.length)}</span>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

/* ── the overlay ───────────────────────────────────────────────────────── */

export function RelationsGraph(props: RelationsGraphProps): ReactElement | null {
  const { open, focusPaperId = null, lang, onClose, onOpenPaper } = props
  const dict = relationsDict[lang]
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => interpolate(dict[key] ?? key, vars),
    [dict],
  )
  const kindLabel = useCallback((kind: RelationKind): string => t(`relations.kind.${kind}`), [t])

  /* data */
  const [papers, setPapers] = useState<PaperSummary[]>([])
  const [relations, setRelations] = useState<PaperRelation[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [loadNonce, setLoadNonce] = useState(0)

  /* view state */
  const [tab, setTab] = useState<'graph' | 'list'>('graph')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [edgeSel, setEdgeSel] = useState<EdgeSelection | null>(null)
  const [edgeConfirm, setEdgeConfirm] = useState(false)
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)
  const [hoverEdgeId, setHoverEdgeId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, k: 1 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [panning, setPanning] = useState(false)
  const [, setFrame] = useState(0)

  /* add-relation modal */
  const [addOpen, setAddOpen] = useState(false)
  const [addFrom, setAddFrom] = useState<string | null>(null)
  const [addTo, setAddTo] = useState<string | null>(null)
  const [addKind, setAddKind] = useState<RelationKind>('related')
  const [addLabel, setAddLabel] = useState('')
  const [addNote, setAddNote] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addSaving, setAddSaving] = useState(false)

  /* list / deletion */
  const [listConfirmId, setListConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  /* refs */
  const panelRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const edgesRef = useRef<SimEdge[]>([])
  const alphaRef = useRef(1)
  const dragRef = useRef<DragState | null>(null)
  const panRef = useRef<PanState | null>(null)
  const suppressClickRef = useRef(false)
  const centerRequestRef = useRef<CenterRequest | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const viewRef = useRef<ViewState>({ x: 0, y: 0, k: 1 })

  const paperById = useMemo(() => new Map(papers.map((paper) => [paper.id, paper])), [papers])
  const degreeById = useMemo(() => {
    const map = new Map<string, number>()
    for (const relation of relations) {
      map.set(relation.from, (map.get(relation.from) ?? 0) + 1)
      map.set(relation.to, (map.get(relation.to) ?? 0) + 1)
    }
    return map
  }, [relations])
  const kindCounts = useMemo(() => {
    const map = new Map<RelationKind, number>()
    for (const relation of relations) map.set(relation.kind, (map.get(relation.kind) ?? 0) + 1)
    return map
  }, [relations])
  const sortedRelations = useMemo(
    () =>
      [...relations].sort((left, right) => {
        if (left.createdAt !== right.createdAt) return right.createdAt.localeCompare(left.createdAt)
        return left.id.localeCompare(right.id)
      }),
    [relations],
  )

  const dataKey = useMemo(() => {
    const paperPart = papers.map((paper) => paper.id).join('|')
    const relationPart = relations
      .map((relation) => `${relation.id}:${relation.kind}:${relation.from}:${relation.to}`)
      .join('|')
    return `${paperPart}#${relationPart}`
  }, [papers, relations])

  const focusPaper = focusPaperId === null ? undefined : paperById.get(focusPaperId)
  const selectedPaper = selectedId === null ? undefined : paperById.get(selectedId)
  const truncated = Math.max(0, papers.length - MAX_GRAPH_NODES)

  const ego = useMemo(() => {
    if (focusPaperId === null || showAll || focusPaper === undefined) return null
    const nodeIds = new Set<string>([focusPaperId])
    const edgeIds = new Set<string>()
    for (const relation of relations) {
      if (relation.from === focusPaperId || relation.to === focusPaperId) {
        edgeIds.add(relation.id)
        nodeIds.add(relation.from)
        nodeIds.add(relation.to)
      }
    }
    return { nodeIds, edgeIds }
  }, [focusPaperId, showAll, focusPaper, relations])

  const hoverNodeIds = useMemo(() => {
    if (hoverNodeId !== null) {
      const ids = new Set<string>([hoverNodeId])
      for (const relation of relations) {
        if (relation.from === hoverNodeId) ids.add(relation.to)
        else if (relation.to === hoverNodeId) ids.add(relation.from)
      }
      return ids
    }
    if (hoverEdgeId !== null) {
      const relation = relations.find((item) => item.id === hoverEdgeId)
      if (relation !== undefined) return new Set<string>([relation.from, relation.to])
    }
    return null
  }, [hoverNodeId, hoverEdgeId, relations])

  const hoverEdgeIds = useMemo(() => {
    if (hoverNodeId !== null) {
      const ids = new Set<string>()
      for (const relation of relations) {
        if (relation.from === hoverNodeId || relation.to === hoverNodeId) ids.add(relation.id)
      }
      return ids
    }
    if (hoverEdgeId !== null) return new Set<string>([hoverEdgeId])
    return null
  }, [hoverNodeId, hoverEdgeId, relations])
  const hoverActive = hoverNodeIds !== null && hoverEdgeIds !== null

  const graphVisible =
    open &&
    tab === 'graph' &&
    (loaded || loadError !== null) &&
    papers.length > 0 &&
    relations.length > 0

  /* ── data loading ────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void (async () => {
      try {
        const [papersPayload, relationsDocument] = await Promise.all([
          api.papers({ limit: 1000 }),
          api.relations(),
        ])
        if (cancelled) return
        setPapers(Array.isArray(papersPayload.papers) ? papersPayload.papers : [])
        setRelations(Array.isArray(relationsDocument.items) ? relationsDocument.items : [])
      } catch (error) {
        if (!cancelled) setLoadError(errorText(error) || t('relations.loadFailed'))
      } finally {
        if (!cancelled) {
          setLoading(false)
          setLoaded(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, loadNonce, t])

  /* ── reset transient state when the overlay opens / focus changes ─────── */

  useEffect(() => {
    if (!open) return
    setTab('graph')
    setSelectedId(focusPaperId)
    setShowAll(false)
    setEdgeSel(null)
    setEdgeConfirm(false)
    setHoverNodeId(null)
    setHoverEdgeId(null)
    setListConfirmId(null)
    setAddOpen(false)
    setAddError(null)
    setActionError(null)
    setView({ x: 0, y: 0, k: 1 })
    centerRequestRef.current = null
    alphaRef.current = 1
  }, [open, focusPaperId])

  /* focus the panel on open and restore the previous focus on close */
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(timer)
      if (previous !== null && previous.isConnected) previous.focus()
    }
  }, [open])

  /* ── Escape: modal → popover → overlay ───────────────────────────────── */

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (addOpen) {
        event.preventDefault()
        event.stopPropagation()
        setAddOpen(false)
        setAddError(null)
        return
      }
      if (edgeSel !== null) {
        event.preventDefault()
        event.stopPropagation()
        setEdgeSel(null)
        setEdgeConfirm(false)
        return
      }
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, addOpen, edgeSel, onClose])

  /* keep latest values reachable from imperative pointer / rAF code */
  useEffect(() => {
    viewRef.current = view
  }, [view])
  useEffect(() => {
    sizeRef.current = size
  }, [size])

  /* ── stage size ──────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!open || !graphVisible) return
    const stage = stageRef.current
    if (stage === null) return
    const measure = () => {
      const rect = stage.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      setSize((current) => (current.w === w && current.h === h ? current : { w, h }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [open, graphVisible])

  /* ── (re)build the graph model when data or stage size changes ────────── */

  useEffect(() => {
    if (!open || !graphVisible) return
    if (size.w < 80 || size.h < 80) return
    const previous = nodesRef.current
    const hadPrevious = previous.length > 0
    const geometry = buildGraph(papers, relations, size.w, size.h, previous, focusPaperId)
    nodesRef.current = geometry.nodes
    edgesRef.current = geometry.edges
    alphaRef.current = hadPrevious ? 0.4 : 1
    setFrame((value) => value + 1)
  }, [open, graphVisible, size.w, size.h, dataKey, focusPaperId, papers, relations])

  /* keep the focused paper centered once the layout settles */
  useEffect(() => {
    if (!open || !graphVisible) return
    if (focusPaperId === null || showAll) return
    centerRequestRef.current = { kind: 'node', id: focusPaperId }
    alphaRef.current = Math.max(alphaRef.current, 0.25)
  }, [open, graphVisible, focusPaperId, showAll, size.w, size.h, dataKey])

  /* ── animation loop (one rAF, cheap when the layout is still) ─────────── */

  useEffect(() => {
    if (!open) return
    let raf = 0
    let alive = true
    const loop = () => {
      if (!alive) return
      const stage = sizeRef.current
      const nodes = nodesRef.current
      if (nodes.length > 0 && stage.w > 80 && stage.h > 80 && alphaRef.current > ALPHA_MIN) {
        const motion = stepSimulation(
          nodes,
          edgesRef.current,
          stage.w,
          stage.h,
          alphaRef.current,
          dragRef.current?.id ?? null,
        )
        if (motion < 0.03) alphaRef.current = 0
        else alphaRef.current *= 0.985
        setFrame((value) => value + 1)
      }
      const request = centerRequestRef.current
      if (request !== null && alphaRef.current < 0.2 && stage.w > 80 && stage.h > 80) {
        if (request.kind === 'fit') {
          setView({ x: 0, y: 0, k: 1 })
          centerRequestRef.current = null
        } else {
          const node = nodes.find((item) => item.id === request.id)
          if (node !== undefined) {
            const zoom = viewRef.current.k
            setView({ x: stage.w / 2 - node.x * zoom, y: stage.h / 2 - node.y * zoom, k: zoom })
            centerRequestRef.current = null
          }
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [open])

  /* ── wheel zoom (native listener so preventDefault works) ─────────────── */

  useEffect(() => {
    if (!open || !graphVisible) return
    const stage = stageRef.current
    if (stage === null) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = stage.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      setView((current) => {
        const factor = Math.exp(-event.deltaY * 0.0015)
        const k = clamp(current.k * factor, 0.28, 3)
        const worldX = (pointerX - current.x) / current.k
        const worldY = (pointerY - current.y) / current.k
        return { x: pointerX - worldX * k, y: pointerY - worldY * k, k }
      })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [open, graphVisible])

  /* ── imperative helpers ──────────────────────────────────────────────── */

  const releasePointer = useCallback((pointerId: number) => {
    const svg = svgRef.current
    if (svg === null) return
    try {
      if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId)
    } catch {
      // Pointer capture is best-effort; never let it break the interaction.
    }
  }, [])

  const beginPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const svg = svgRef.current
    if (svg === null) return
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
    }
    setPanning(true)
    try {
      svg.setPointerCapture(event.pointerId)
    } catch {
      // Ignore capture failures (e.g. synthetic pointer events).
    }
  }

  const handleSvgPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (drag !== null) {
      const node = nodesRef.current.find((item) => item.id === drag.id)
      if (node !== undefined) {
        const zoom = Math.max(0.05, viewRef.current.k)
        const deltaX = (event.clientX - drag.lastX) / zoom
        const deltaY = (event.clientY - drag.lastY) / zoom
        drag.lastX = event.clientX
        drag.lastY = event.clientY
        if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 3) {
          drag.moved = true
        }
        const stage = sizeRef.current
        node.x = clamp(node.x + deltaX, 26, Math.max(27, stage.w - 26))
        node.y = clamp(node.y + deltaY, 26, Math.max(27, stage.h - 26))
        node.vx = 0
        node.vy = 0
        alphaRef.current = Math.max(alphaRef.current, 0.22)
        setFrame((value) => value + 1)
      }
      return
    }
    const pan = panRef.current
    if (pan !== null) {
      if (Math.abs(event.clientX - pan.startX) + Math.abs(event.clientY - pan.startY) > 3) {
        pan.moved = true
      }
      setView({
        x: pan.originX + (event.clientX - pan.startX),
        y: pan.originY + (event.clientY - pan.startY),
        k: viewRef.current.k,
      })
    }
  }

  const handleSvgPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (drag !== null) {
      dragRef.current = null
      releasePointer(drag.pointerId)
      suppressClickRef.current = true
      if (!drag.moved) {
        setSelectedId(drag.id)
        setEdgeSel(null)
        setEdgeConfirm(false)
      }
      return
    }
    const pan = panRef.current
    if (pan !== null) {
      panRef.current = null
      setPanning(false)
      releasePointer(pan.pointerId)
      if (pan.moved) suppressClickRef.current = true
    }
  }

  const handleSvgPointerCancel = () => {
    const drag = dragRef.current
    if (drag !== null) releasePointer(drag.pointerId)
    dragRef.current = null
    const pan = panRef.current
    if (pan !== null) releasePointer(pan.pointerId)
    panRef.current = null
    setPanning(false)
  }

  const handleBackgroundClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) {
      suppressClickRef.current = false
      return
    }
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    setSelectedId(null)
    setEdgeSel(null)
    setEdgeConfirm(false)
  }

  const handleNodePointerDown = (event: ReactPointerEvent<SVGGElement>, nodeId: string) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const svg = svgRef.current
    dragRef.current = {
      id: nodeId,
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
    alphaRef.current = Math.max(alphaRef.current, 0.25)
    if (svg !== null) {
      try {
        svg.setPointerCapture(event.pointerId)
      } catch {
        // Ignore capture failures.
      }
    }
  }

  const selectNodeByKeyboard = (nodeId: string) => {
    setSelectedId(nodeId)
    setEdgeSel(null)
    setEdgeConfirm(false)
  }

  const openEdgeAt = (relation: PaperRelation, x: number, y: number) => {
    setEdgeSel({ id: relation.id, x, y })
    setEdgeConfirm(false)
    setSelectedId(null)
    setHoverEdgeId(null)
  }

  const openEdgeFromEvent = (
    event: ReactMouseEvent<SVGPathElement>,
    relation: PaperRelation,
  ) => {
    event.stopPropagation()
    const stage = stageRef.current
    if (stage === null) return
    const rect = stage.getBoundingClientRect()
    openEdgeAt(
      relation,
      clamp(event.clientX - rect.left, 8, Math.max(8, rect.width - 308)),
      clamp(event.clientY - rect.top, 8, Math.max(8, rect.height - 260)),
    )
  }

  const openEdgeFromKeyboard = (
    event: ReactKeyboardEvent<SVGPathElement>,
    relation: PaperRelation,
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    const stage = stageRef.current
    if (stage === null) return
    const rect = stage.getBoundingClientRect()
    openEdgeAt(relation, Math.max(8, rect.width / 2 - 150), Math.max(8, rect.height / 2 - 120))
  }

  const zoomBy = (factor: number) => {
    const stage = sizeRef.current
    if (stage.w <= 0 || stage.h <= 0) return
    setView((current) => {
      const k = clamp(current.k * factor, 0.28, 3)
      const worldX = (stage.w / 2 - current.x) / current.k
      const worldY = (stage.h / 2 - current.y) / current.k
      return { x: stage.w / 2 - worldX * k, y: stage.h / 2 - worldY * k, k }
    })
  }

  const resetView = () => {
    setView({ x: 0, y: 0, k: 1 })
  }

  const showFullGraph = () => {
    setShowAll(true)
    centerRequestRef.current = { kind: 'fit' }
    alphaRef.current = Math.max(alphaRef.current, 0.2)
  }

  const focusCurrentPaper = () => {
    if (focusPaperId === null) return
    setShowAll(false)
    setSelectedId(focusPaperId)
    centerRequestRef.current = { kind: 'node', id: focusPaperId }
    alphaRef.current = Math.max(alphaRef.current, 0.25)
  }

  const locateRelation = (relation: PaperRelation) => {
    setTab('graph')
    setSelectedId(null)
    setEdgeConfirm(false)
    centerRequestRef.current = null
    const stage = sizeRef.current
    const a = nodesRef.current.find((node) => node.id === relation.from)
    const b = nodesRef.current.find((node) => node.id === relation.to)
    if (a !== undefined && b !== undefined && stage.w > 80 && stage.h > 80) {
      const k = Math.max(viewRef.current.k, 0.9)
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      setView({ x: stage.w / 2 - midX * k, y: stage.h / 2 - midY * k, k })
      setEdgeSel({ id: relation.id, x: Math.max(8, stage.w / 2 - 150), y: Math.max(8, stage.h / 2 - 120) })
    } else {
      setEdgeSel({ id: relation.id, x: 16, y: 16 })
    }
  }

  const openAdd = (from: string | null) => {
    setAddFrom(from)
    setAddTo(null)
    setAddKind('related')
    setAddLabel('')
    setAddNote('')
    setAddError(null)
    setActionError(null)
    setAddOpen(true)
  }

  const closeAdd = useCallback(() => {
    setAddOpen(false)
    setAddError(null)
  }, [])

  const relationMutationError = (error: unknown, fallbackKey: string): string => {
    const message = errorText(error)
    if (message !== '' && /already exists/i.test(message)) return t('relations.form.duplicate')
    return message !== '' ? message : t(fallbackKey)
  }

  const submitAdd = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (addSaving) return
    if (addFrom === null) {
      setAddError(t('relations.form.requiredFrom'))
      return
    }
    if (addTo === null) {
      setAddError(t('relations.form.requiredTo'))
      return
    }
    if (addFrom === addTo) {
      setAddError(t('relations.form.self'))
      return
    }
    const label = addLabel.trim()
    const note = addNote.trim()
    if (label.length > LABEL_MAX) {
      setAddError(t('relations.form.labelTooLong'))
      return
    }
    if (note.length > NOTE_MAX) {
      setAddError(t('relations.form.noteTooLong'))
      return
    }
    const from = addFrom
    const to = addTo
    const duplicate = relations.some(
      (relation) =>
        relation.kind === addKind &&
        ((relation.from === from && relation.to === to) || (relation.from === to && relation.to === from)),
    )
    if (duplicate) {
      setAddError(t('relations.form.duplicate'))
      return
    }

    setAddSaving(true)
    setAddError(null)
    void (async () => {
      try {
        const input: NewRelation = {
          from,
          to,
          kind: addKind,
          source: 'user',
          ...(label !== '' ? { label } : {}),
          ...(note !== '' ? { note } : {}),
        }
        const document = await api.addRelation(input)
        setRelations(Array.isArray(document.items) ? document.items : [])
        setAddOpen(false)
        setTab('graph')
        setShowAll(false)
        setSelectedId(from)
        setEdgeSel(null)
        setEdgeConfirm(false)
        centerRequestRef.current = { kind: 'node', id: from }
        alphaRef.current = Math.max(alphaRef.current, 0.3)
      } catch (error) {
        setAddError(relationMutationError(error, 'relations.form.failed'))
      } finally {
        setAddSaving(false)
      }
    })()
  }

  const removeRelation = (relationId: string) => {
    if (deletingId !== null) return
    setDeletingId(relationId)
    setActionError(null)
    void (async () => {
      try {
        const document = await api.deleteRelation(relationId)
        setRelations(Array.isArray(document.items) ? document.items : [])
        setEdgeSel((current) => (current !== null && current.id === relationId ? null : current))
        setListConfirmId(null)
        setEdgeConfirm(false)
      } catch (error) {
        setActionError(relationMutationError(error, 'relations.deleteFailed'))
      } finally {
        setDeletingId(null)
      }
    })()
  }

  if (!open) return null

  const selectedEdge = edgeSel === null ? undefined : relations.find((relation) => relation.id === edgeSel.id)
  const stageWidth = size.w
  const stageHeight = size.h
  const showLoadingState = (loading || !loaded) && loadError === null
  const showErrorState = loadError !== null && papers.length === 0 && relations.length === 0
  const showNoPapersState = !showLoadingState && !showErrorState && papers.length === 0
  const showNoRelationsState =
    !showLoadingState && !showErrorState && !showNoPapersState && relations.length === 0

  const titleOf = (paperId: string): string => paperById.get(paperId)?.title ?? paperId

  /* ── render: graph tab ───────────────────────────────────────────────── */

  const renderGraphTab = (): ReactElement => {
    if (showLoadingState) {
      return (
        <div className="pd-rel-state" role="status" aria-live="polite">
          <span className="pd-rel-spinner" aria-hidden="true" />
          <span className="pd-rel-state-desc">{t('relations.loading')}</span>
        </div>
      )
    }
    if (showErrorState) {
      return (
        <div className="pd-rel-state" role="alert">
          <span className="pd-rel-state-title">{t('relations.loadFailed')}</span>
          <span className="pd-rel-state-desc">{loadError}</span>
          <div className="pd-rel-state-actions">
            <button
              type="button"
              className="pd-rel-btn"
              onClick={() => setLoadNonce((value) => value + 1)}
            >
              {t('relations.retry')}
            </button>
          </div>
        </div>
      )
    }
    if (showNoPapersState) {
      return (
        <div className="pd-rel-state">
          <span className="pd-rel-state-title">{t('relations.empty.noPapers')}</span>
          <span className="pd-rel-state-desc">{t('relations.empty.noPapersDesc')}</span>
        </div>
      )
    }
    if (showNoRelationsState) {
      return (
        <div className="pd-rel-state">
          <span className="pd-rel-state-title">{t('relations.empty')}</span>
          <span className="pd-rel-state-desc">{t('relations.empty.desc')}</span>
          <div className="pd-rel-state-actions">
            <button
              type="button"
              className="pd-rel-btn pd-rel-btn-primary"
              onClick={() => openAdd(selectedId ?? focusPaperId)}
            >
              {t('relations.add')}
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="pd-rel-stage" ref={stageRef}>
        <svg
          ref={svgRef}
          className="pd-rel-svg"
          role="group"
          aria-label={t('relations.aria.graph')}
          data-panning={panning ? 'true' : 'false'}
          onPointerDown={beginPan}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerUp}
          onPointerCancel={handleSvgPointerCancel}
          onClick={handleBackgroundClick}
        >
          <defs>
            <marker
              id="pd-rel-arrow"
              viewBox="0 0 9 9"
              refX="7.5"
              refY="4.5"
              markerWidth="9"
              markerHeight="9"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path className="pd-rel-arrow-head" d="M0,0 L8,4.5 L0,9 z" />
            </marker>
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <g className="pd-rel-edges">
              {edgesRef.current.map((edge) => {
                const relation = edge.relation
                const geometry = edgeGeometry(edge)
                const active = hoverEdgeId === relation.id || edgeSel?.id === relation.id
                const dimmed =
                  (ego !== null && !ego.edgeIds.has(relation.id)) ||
                  (hoverActive && hoverEdgeIds !== null && !hoverEdgeIds.has(relation.id))
                return (
                  <g key={relation.id} className="pd-rel-edge-group">
                    <path
                      className="pd-rel-edge"
                      d={geometry.path}
                      data-kind={relation.kind}
                      data-active={active ? 'true' : 'false'}
                      data-dim={dimmed ? 'true' : 'false'}
                      markerEnd={relation.kind === 'cites' ? 'url(#pd-rel-arrow)' : undefined}
                    />
                    <path
                      className="pd-rel-edge-hit"
                      d={geometry.path}
                      tabIndex={0}
                      role="button"
                      aria-label={t('relations.aria.edge', {
                        from: titleOf(relation.from),
                        to: titleOf(relation.to),
                        kind: kindLabel(relation.kind),
                      })}
                      onPointerDown={(event) => event.stopPropagation()}
                      onPointerEnter={() => setHoverEdgeId(relation.id)}
                      onPointerLeave={() => setHoverEdgeId((current) => (current === relation.id ? null : current))}
                      onFocus={() => setHoverEdgeId(relation.id)}
                      onBlur={() => setHoverEdgeId((current) => (current === relation.id ? null : current))}
                      onClick={(event) => openEdgeFromEvent(event, relation)}
                      onKeyDown={(event) => openEdgeFromKeyboard(event, relation)}
                    />
                    {active && relation.label !== '' ? (
                      <text className="pd-rel-edge-label" x={geometry.midX} y={geometry.midY - 5} textAnchor="middle">
                        {relation.label}
                      </text>
                    ) : null}
                  </g>
                )
              })}
            </g>
            <g className="pd-rel-nodes">
              {nodesRef.current.map((node) => {
                const isSelected = selectedId === node.id
                const isFocus = focusPaperId === node.id
                const dimmed =
                  (ego !== null && !ego.nodeIds.has(node.id)) ||
                  (hoverActive && hoverNodeIds !== null && !hoverNodeIds.has(node.id))
                return (
                  <g
                    key={node.id}
                    className="pd-rel-node"
                    transform={`translate(${node.x} ${node.y})`}
                    data-status={node.paper.status}
                    data-selected={isSelected ? 'true' : 'false'}
                    data-hover={hoverNodeId === node.id ? 'true' : 'false'}
                    data-dim={dimmed ? 'true' : 'false'}
                    role="button"
                    tabIndex={0}
                    aria-label={t('relations.aria.node', {
                      title: node.paper.title,
                      n: degreeById.get(node.id) ?? 0,
                    })}
                    onPointerDown={(event) => handleNodePointerDown(event, node.id)}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false
                        return
                      }
                      selectNodeByKeyboard(node.id)
                    }}
                    onPointerEnter={() => setHoverNodeId(node.id)}
                    onPointerLeave={() => setHoverNodeId((current) => (current === node.id ? null : current))}
                    onFocus={() => setHoverNodeId(node.id)}
                    onBlur={() => setHoverNodeId((current) => (current === node.id ? null : current))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        selectNodeByKeyboard(node.id)
                      }
                    }}
                  >
                    {isSelected || isFocus ? (
                      <circle className="pd-rel-node-halo" r={node.radius + 6} aria-hidden="true" />
                    ) : null}
                    <circle className="pd-rel-node-hit" r={node.radius + 8} aria-hidden="true" />
                    <circle className="pd-rel-node-circle" r={node.radius} aria-hidden="true" />
                    <circle
                      className="pd-rel-node-dot"
                      r={2.4}
                      cx={node.radius * 0.72}
                      cy={-node.radius * 0.72}
                      aria-hidden="true"
                    />
                    <text className="pd-rel-node-label" y={node.radius + 12} textAnchor="middle" aria-hidden="true">
                      {node.short}
                    </text>
                  </g>
                )
              })}
            </g>
          </g>
        </svg>

        <div className="pd-rel-zoom" role="group" aria-label={t('relations.aria.zoom')}>
          <button
            type="button"
            className="pd-rel-iconbtn"
            aria-label={t('relations.zoomIn')}
            title={t('relations.zoomIn')}
            onClick={() => zoomBy(1.25)}
          >
            +
          </button>
          <button
            type="button"
            className="pd-rel-iconbtn"
            aria-label={t('relations.zoomOut')}
            title={t('relations.zoomOut')}
            onClick={() => zoomBy(0.8)}
          >
            −
          </button>
          <button
            type="button"
            className="pd-rel-iconbtn"
            aria-label={t('relations.zoomReset')}
            title={t('relations.zoomReset')}
            onClick={resetView}
          >
            <IconRefresh />
          </button>
        </div>
        <div className="pd-rel-hint">{t('relations.hint')}</div>

        {selectedEdge !== undefined && edgeSel !== null ? (
          <div
            className="pd-rel-pop"
            role="dialog"
            aria-modal="false"
            aria-label={t('relations.edge.title')}
            style={{
              left: Math.max(
                8,
                Math.min(edgeSel.x, Math.max(8, stageWidth - 308)),
              ),
              top: Math.max(
                8,
                Math.min(edgeSel.y, Math.max(8, stageHeight - 250)),
              ),
            }}
          >
            <div className="pd-rel-pop-head">
              <span className="pd-rel-swatch" data-kind={selectedEdge.kind} aria-hidden="true" />
              <span className="pd-rel-pop-title">{t('relations.edge.title')}</span>
              <button
                type="button"
                className="pd-rel-pop-close"
                aria-label={t('relations.close')}
                title={t('relations.close')}
                onClick={() => {
                  setEdgeSel(null)
                  setEdgeConfirm(false)
                }}
              >
                ×
              </button>
            </div>
            <div className="pd-rel-pop-pair">
              <span>{titleOf(selectedEdge.from)}</span>
              <span className="pd-rel-pop-arrow" aria-hidden="true">
                ↔
              </span>
              <span>{titleOf(selectedEdge.to)}</span>
            </div>
            <div className="pd-rel-kv">
              <span className="pd-rel-kv-key">{t('relations.form.kind')}</span>
              <span className="pd-rel-kv-val">{kindLabel(selectedEdge.kind)}</span>
            </div>
            <div className="pd-rel-kv">
              <span className="pd-rel-kv-key">{t('relations.edge.label')}</span>
              <span className="pd-rel-kv-val">{selectedEdge.label !== '' ? selectedEdge.label : t('relations.none')}</span>
            </div>
            <div className="pd-rel-kv">
              <span className="pd-rel-kv-key">{t('relations.edge.note')}</span>
              <span className="pd-rel-kv-val">{selectedEdge.note !== '' ? selectedEdge.note : t('relations.none')}</span>
            </div>
            <div className="pd-rel-kv">
              <span className="pd-rel-kv-key">{t('relations.edge.source')}</span>
              <span className="pd-rel-kv-val">
                {selectedEdge.source === 'agent' ? t('relations.edge.source.agent') : t('relations.edge.source.user')}
              </span>
            </div>
            {edgeConfirm ? (
              <div className="pd-rel-pop-confirm">
                <span className="pd-rel-pop-confirm-text">{t('relations.edge.deleteConfirm')}</span>
                <div className="pd-rel-pop-confirm-actions">
                  <button
                    type="button"
                    className="pd-rel-btn pd-rel-btn-sm"
                    onClick={() => setEdgeConfirm(false)}
                  >
                    {t('relations.edge.deleteNo')}
                  </button>
                  <button
                    type="button"
                    className="pd-rel-btn pd-rel-btn-danger pd-rel-btn-sm"
                    disabled={deletingId === selectedEdge.id}
                    onClick={() => removeRelation(selectedEdge.id)}
                  >
                    {deletingId === selectedEdge.id ? t('relations.loading') : t('relations.edge.deleteYes')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="pd-rel-pop-actions">
                <button
                  type="button"
                  className="pd-rel-btn pd-rel-btn-danger pd-rel-btn-sm"
                  onClick={() => setEdgeConfirm(true)}
                >
                  {t('relations.edge.delete')}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    )
  }

  /* ── render: list tab ────────────────────────────────────────────────── */

  const renderListTab = (): ReactElement => {
    if (showLoadingState) {
      return (
        <div className="pd-rel-state" role="status" aria-live="polite">
          <span className="pd-rel-spinner" aria-hidden="true" />
          <span className="pd-rel-state-desc">{t('relations.loading')}</span>
        </div>
      )
    }
    if (showErrorState) {
      return (
        <div className="pd-rel-state" role="alert">
          <span className="pd-rel-state-title">{t('relations.loadFailed')}</span>
          <span className="pd-rel-state-desc">{loadError}</span>
          <div className="pd-rel-state-actions">
            <button type="button" className="pd-rel-btn" onClick={() => setLoadNonce((value) => value + 1)}>
              {t('relations.retry')}
            </button>
          </div>
        </div>
      )
    }
    return (
      <div className="pd-rel-list">
        <span className="pd-rel-list-hint">{t('relations.list.hint')}</span>
        {sortedRelations.length === 0 ? (
          <span className="pd-rel-list-empty">{t('relations.list.empty')}</span>
        ) : (
          <ul className="pd-rel-list-ul">
            {sortedRelations.map((relation) => (
              <li
                key={relation.id}
                className="pd-rel-list-row"
                data-selected={edgeSel?.id === relation.id ? 'true' : 'false'}
              >
                <button
                  type="button"
                  className="pd-rel-list-main"
                  onClick={() => locateRelation(relation)}
                >
                  <span className="pd-rel-list-titles">
                    <span className="pd-rel-list-title">{titleOf(relation.from)}</span>
                    <span className="pd-rel-list-arrow" aria-hidden="true">
                      ↔
                    </span>
                    <span className="pd-rel-list-title">{titleOf(relation.to)}</span>
                  </span>
                  <span className="pd-rel-list-badges">
                    <span className="pd-rel-kind" data-kind={relation.kind}>
                      <span className="pd-rel-swatch" data-kind={relation.kind} aria-hidden="true" />
                      {kindLabel(relation.kind)}
                    </span>
                    {relation.label !== '' ? (
                      <span className="pd-rel-list-label">
                        {t('relations.list.label')}: {relation.label}
                      </span>
                    ) : null}
                  </span>
                  {relation.note !== '' ? <span className="pd-rel-list-note">{relation.note}</span> : null}
                </button>
                <div className="pd-rel-list-actions">
                  {listConfirmId === relation.id ? (
                    <>
                      <span className="pd-rel-list-confirm-text">{t('relations.list.deleteConfirm')}</span>
                      <button
                        type="button"
                        className="pd-rel-btn pd-rel-btn-sm"
                        onClick={() => setListConfirmId(null)}
                      >
                        {t('relations.edge.deleteNo')}
                      </button>
                      <button
                        type="button"
                        className="pd-rel-btn pd-rel-btn-danger pd-rel-btn-sm"
                        disabled={deletingId === relation.id}
                        onClick={() => removeRelation(relation.id)}
                      >
                        {deletingId === relation.id ? t('relations.loading') : t('relations.edge.deleteYes')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="pd-rel-btn pd-rel-btn-ghost pd-rel-btn-sm"
                      onClick={() => setListConfirmId(relation.id)}
                    >
                      {t('relations.list.delete')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  /* ── assemble ────────────────────────────────────────────────────────── */

  return (
    <div
      className="pd-rel-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className="pd-rel-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pd-rel-title"
        tabIndex={-1}
      >
        <header className="pd-rel-head">
          <div className="pd-rel-head-main">
            <span className="pd-rel-mark" aria-hidden="true">
              <IconGraph />
            </span>
            <div className="pd-rel-head-text">
              <h2 className="pd-rel-title" id="pd-rel-title">
                {t('relations.title')}
              </h2>
              <span className="pd-rel-sub">
                {t('relations.subtitle', { papers: papers.length, relations: relations.length })}
              </span>
            </div>
          </div>
          <div className="pd-rel-tabs" role="tablist" aria-label={t('relations.aria.tabs')}>
            <button
              type="button"
              role="tab"
              id="pd-rel-tab-graph"
              className="pd-rel-tab"
              data-on={tab === 'graph' ? 'true' : 'false'}
              aria-selected={tab === 'graph'}
              aria-controls="pd-rel-panel-graph"
              onClick={() => setTab('graph')}
            >
              {t('relations.tab.graph')}
            </button>
            <button
              type="button"
              role="tab"
              id="pd-rel-tab-list"
              className="pd-rel-tab"
              data-on={tab === 'list' ? 'true' : 'false'}
              aria-selected={tab === 'list'}
              aria-controls="pd-rel-panel-list"
              onClick={() => setTab('list')}
            >
              {t('relations.tab.list')}
            </button>
          </div>
          <div className="pd-rel-head-actions">
            <button
              type="button"
              className="pd-rel-btn pd-rel-btn-primary"
              disabled={papers.length === 0}
              onClick={() => openAdd(selectedId ?? focusPaperId)}
            >
              {t('relations.add')}
            </button>
            <button
              type="button"
              className="pd-rel-iconbtn"
              aria-label={t('relations.refresh')}
              title={t('relations.refresh')}
              onClick={() => setLoadNonce((value) => value + 1)}
            >
              <IconRefresh />
            </button>
            <button
              type="button"
              className="pd-rel-iconbtn"
              aria-label={t('relations.close')}
              title={t('relations.close')}
              onClick={onClose}
            >
              <IconClose />
            </button>
          </div>
        </header>

        {focusPaper !== undefined ? (
          <div className="pd-rel-focus" data-all={showAll ? 'true' : 'false'}>
            <span className="pd-rel-focus-dot" aria-hidden="true" />
            <span className="pd-rel-focus-label" title={focusPaper.title}>
              {t('relations.focus.label', { title: focusPaper.title })}
            </span>
            {showAll ? (
              <button type="button" className="pd-rel-btn pd-rel-btn-sm" onClick={focusCurrentPaper}>
                {t('relations.focus.refocus')}
              </button>
            ) : (
              <button type="button" className="pd-rel-btn pd-rel-btn-sm" onClick={showFullGraph}>
                {t('relations.focus.showAll')}
              </button>
            )}
          </div>
        ) : null}

        {loadError !== null && !showErrorState ? (
          <div className="pd-rel-banner" role="alert">
            <span>{loadError}</span>
            <button
              type="button"
              className="pd-rel-btn pd-rel-btn-sm"
              onClick={() => setLoadNonce((value) => value + 1)}
            >
              {t('relations.retry')}
            </button>
          </div>
        ) : null}
        {actionError !== null ? (
          <div className="pd-rel-banner" role="alert">
            <span>{actionError}</span>
            <button
              type="button"
              className="pd-rel-banner-x"
              aria-label={t('relations.dismiss')}
              title={t('relations.dismiss')}
              onClick={() => setActionError(null)}
            >
              ×
            </button>
          </div>
        ) : null}
        {truncated > 0 && tab === 'graph' ? (
          <div className="pd-rel-banner" data-kind="info">
            <span>{t('relations.truncated', { n: MAX_GRAPH_NODES })}</span>
          </div>
        ) : null}

        <div className="pd-rel-body">
          <div className="pd-rel-main">
            {tab === 'graph' ? (
              <div
                id="pd-rel-panel-graph"
                role="tabpanel"
                aria-labelledby="pd-rel-tab-graph"
                style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, minWidth: 0 }}
              >
                {renderGraphTab()}
              </div>
            ) : (
              <div
                id="pd-rel-panel-list"
                role="tabpanel"
                aria-labelledby="pd-rel-tab-list"
                style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, minWidth: 0 }}
              >
                {renderListTab()}
              </div>
            )}
          </div>

          <aside className="pd-rel-aside">
            {selectedPaper !== undefined ? (
              <div className="pd-rel-card">
                <h3 className="pd-rel-card-title">{selectedPaper.title}</h3>
                <div className="pd-rel-card-row">
                  <span className="pd-rel-card-key">{t('relations.detail.year')}</span>
                  <span className="pd-rel-card-val">
                    {selectedPaper.year === null ? t('relations.none') : selectedPaper.year}
                  </span>
                </div>
                <div className="pd-rel-card-row">
                  <span className="pd-rel-card-key">{t('relations.detail.venue')}</span>
                  <span className="pd-rel-card-val">
                    {selectedPaper.venue !== '' ? selectedPaper.venue : t('relations.none')}
                  </span>
                </div>
                <div className="pd-rel-card-row">
                  <span className="pd-rel-card-key">{t('relations.detail.authors')}</span>
                  <span className="pd-rel-card-val">
                    {selectedPaper.authors.length > 0 ? selectedPaper.authors.join(', ') : t('relations.none')}
                  </span>
                </div>
                <div className="pd-rel-card-row">
                  <span className="pd-rel-card-key">{t('relations.detail.count')}</span>
                  <span className="pd-rel-card-val">
                    {t('relations.detail.relations', { n: degreeById.get(selectedPaper.id) ?? 0 })}
                  </span>
                </div>
                <div className="pd-rel-card-actions">
                  <button
                    type="button"
                    className="pd-rel-btn pd-rel-btn-primary pd-rel-btn-sm"
                    onClick={() => {
                      onOpenPaper(selectedPaper.id)
                      onClose()
                    }}
                  >
                    {t('relations.detail.open')}
                  </button>
                  <button
                    type="button"
                    className="pd-rel-btn pd-rel-btn-sm"
                    onClick={() => openAdd(selectedPaper.id)}
                  >
                    {t('relations.detail.add')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="pd-rel-card pd-rel-card-empty">{t('relations.detail.none')}</div>
            )}

            <div className="pd-rel-legend" role="group" aria-label={t('relations.aria.legend')}>
              <span className="pd-rel-legend-title">{t('relations.legend')}</span>
              {RELATION_KINDS.map((kind) => (
                <div className="pd-rel-legend-row" key={kind}>
                  <span className="pd-rel-swatch" data-kind={kind} aria-hidden="true" />
                  <span className="pd-rel-legend-kind">{kindLabel(kind)}</span>
                  <span className="pd-rel-legend-count">{kindCounts.get(kind) ?? 0}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>

        {addOpen ? (
          <div
            className="pd-rel-modal-mask"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeAdd()
            }}
          >
            <div className="pd-rel-modal" role="dialog" aria-modal="true" aria-labelledby="pd-rel-add-title">
              <div className="pd-rel-modal-head">
                <h3 className="pd-rel-modal-title" id="pd-rel-add-title">
                  {t('relations.form.title')}
                </h3>
                <button
                  type="button"
                  className="pd-rel-iconbtn"
                  aria-label={t('relations.close')}
                  title={t('relations.close')}
                  onClick={closeAdd}
                >
                  <IconClose />
                </button>
              </div>
              <form className="pd-rel-form" onSubmit={submitAdd} noValidate>
                <div className="pd-rel-modal-body">
                  <p className="pd-rel-modal-desc">{t('relations.form.desc')}</p>
                  <div className="pd-rel-field-row">
                    <div className="pd-rel-field">
                      <label className="pd-rel-field-label" htmlFor="pd-rel-from-search">
                        {t('relations.form.from')}
                      </label>
                      <PaperPicker
                        inputId="pd-rel-from-search"
                        papers={papers}
                        value={addFrom}
                        onChange={setAddFrom}
                        placeholder={t('relations.form.notSelected')}
                        searchPlaceholder={t('relations.form.search')}
                        noMatch={t('relations.form.noMatch')}
                        clearLabel={t('relations.form.clear')}
                        ariaLabel={t('relations.aria.pickerFrom')}
                        narrowLabel={(count) => t('relations.form.narrow', { n: count })}
                        autoFocus
                      />
                    </div>
                    <div className="pd-rel-field">
                      <label className="pd-rel-field-label" htmlFor="pd-rel-to-search">
                        {t('relations.form.to')}
                      </label>
                      <PaperPicker
                        inputId="pd-rel-to-search"
                        papers={papers}
                        value={addTo}
                        onChange={setAddTo}
                        placeholder={t('relations.form.notSelected')}
                        searchPlaceholder={t('relations.form.search')}
                        noMatch={t('relations.form.noMatch')}
                        clearLabel={t('relations.form.clear')}
                        ariaLabel={t('relations.aria.pickerTo')}
                        narrowLabel={(count) => t('relations.form.narrow', { n: count })}
                      />
                    </div>
                  </div>
                  <div className="pd-rel-field">
                    <label className="pd-rel-field-label" htmlFor="pd-rel-kind">
                      {t('relations.form.kind')}
                    </label>
                    <select
                      id="pd-rel-kind"
                      className="pd-rel-select"
                      value={addKind}
                      onChange={(event) => setAddKind(event.target.value as RelationKind)}
                    >
                      {RELATION_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kindLabel(kind)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="pd-rel-field">
                    <label className="pd-rel-field-label" htmlFor="pd-rel-label-input">
                      {t('relations.form.label')}
                    </label>
                    <input
                      id="pd-rel-label-input"
                      className="pd-rel-input"
                      value={addLabel}
                      maxLength={LABEL_MAX}
                      placeholder={t('relations.form.labelPlaceholder')}
                      onChange={(event) => setAddLabel(event.target.value)}
                    />
                  </div>
                  <div className="pd-rel-field">
                    <label className="pd-rel-field-label" htmlFor="pd-rel-note-input">
                      {t('relations.form.note')}
                    </label>
                    <textarea
                      id="pd-rel-note-input"
                      className="pd-rel-textarea"
                      value={addNote}
                      maxLength={NOTE_MAX}
                      placeholder={t('relations.form.notePlaceholder')}
                      onChange={(event) => setAddNote(event.target.value)}
                    />
                  </div>
                  {addError !== null ? (
                    <div className="pd-rel-error" role="alert">
                      {addError}
                    </div>
                  ) : null}
                </div>
                <div className="pd-rel-modal-foot">
                  <button type="button" className="pd-rel-btn" onClick={closeAdd}>
                    {t('relations.form.cancel')}
                  </button>
                  <button type="submit" className="pd-rel-btn pd-rel-btn-primary" disabled={addSaving}>
                    {addSaving ? t('relations.form.saving') : t('relations.form.submit')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
