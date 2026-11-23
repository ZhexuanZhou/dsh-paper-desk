# Paper reproduction · 1.3.0

The reader gains one Reproduction tab. Its independent, paper-linked document explains how the method maps to code and exports a self-contained Markdown task for another agent. It is not stored as a note/card/topic and does not execute training. Existing notes and cards remain separate.

Inputs: paper metadata, bounded PDF excerpts with page coverage, optional user requirements, verified external sources when Host browsing is available, and explicitly quoted comments/logs. Missing sources/parameters must remain visible. Paper claims, implementation choices and assumptions are distinguished. No external package or search provider is added.

Output: `papers/<id>/reproduction.json` contains the editable raw Markdown, requirements, original source snapshot/fingerprint and generation/update timestamps. A completed document never changes experiment verification status. User-reported logs may be discussed and incorporated, but are not proof of execution by this product.

Writes use the existing per-document serialized queue, expected content hash, pre-edit snapshots and external-change check. History is independent under `.paperdesk/history/<id>/reproduction/`; restoring also snapshots the current version. Source changes preserve the prior guide and mark it stale. Opening a saved guide never resubmits a model request. Explicit generation uses a separate session from discussion and saves only a completed answer.

UI follows the reader typography, subdued colors, document-first layout, normal chat composer, inline source disclosure, raw Markdown editor and history dialog. Selection alone does not open a comment editor. Explicit comments enter the normal question composer. Narrow screens retain the document with an optional discussion overlay and a stable side divider.

Export includes paper title/authors/URLs/fingerprint, user requirements, the exact raw Markdown and execution/delivery criteria. It preserves TeX and code fences. It cannot depend on plugin IDs/tools, previous conversation or machine-specific paths. Missing PDF access is explicitly described instead of invented. An executor must distinguish synthetic smoke tests from reproduction of published metrics.

Related resource URLs are extracted only from a text cache matching the current PDF fingerprint. They retain page numbers and are labelled as PDF-provided, not web-verified or official author code. Export includes these references even when the model omitted them from its prose. Numerical criteria require absolute/relative tolerances with a positive denominator floor, zero/degenerate/non-finite cases, and separate deterministic-result comparisons from timing measurements. Returned parameters and derived metrics must describe the same state, including the final update. Pass, fail and incomplete results are distinct; reporting nonconvergence does not satisfy an accuracy target.

Navigation pauses autosave before asking about unsaved changes. Discard waits for an in-flight write and may revert only this editor's own write to its captured baseline; another writer's version is never replaced. Formula comments preserve complete TeX even when the selection crosses native MathML nodes. GFM tables protect pipes within code/math during parsing without changing saved or copied Markdown.

Rows with more unescaped separators than the header declares fall back to a labelled, full-width original row. This avoids GFM's silent truncation without guessing which plain-text absolute-value bars should be column boundaries. Valid rows keep their normal cells; the stored and exported source stays unchanged.

Acceptance: real model generation and persisted reopen without rerun; explicit conversation edit with an actual write and isolated notes/cards; portable source-preserving export; version preview/restore/undo; cancellation/error preserving prior document and drafts; native plugin update and readable light/dark/narrow layouts. Programmatic checks cover API/version conflicts, source staleness, malformed histories, original Markdown, context bounds and portable execution requirements.
