# Mutation Bay → React Flow patch-panel canvas

## Context

The Mutation Bay's take trees are currently rendered with a hand-rolled recursive flex layout and CSS pseudo-element elbow connectors (`PartRow.tsx` + `styles.css`), one horizontally-scrolling strip per part. Joe wants a mature node-graph ("patch panel") view like ComfyUI's. Research findings: ComfyUI uses its **own fork of litegraph.js** (Canvas2D, now merged into the ComfyUI_frontend monorepo; the standalone repo is archived) — not reusable in a React 19 + Mantine app with rich DOM node bodies. The mature React-native equivalent is **React Flow** (`@xyflow/react` 12.11.1, MIT, React 19-compatible, xyflow team, maintained since 2019).

**Decisions made by Joe:** use React Flow; ONE shared pan/zoom canvas for the whole bay (each part's tree in its own horizontal lane, origins on the left); auto-layout via dagre LR, nodes NOT draggable, no positions persisted — `PartVariation` and all of `workbench.ts` stay unchanged.

New deps: `@xyflow/react@12.11.1` + `@dagrejs/dagre@3` (both MIT; xyflow brings zustand + classcat). CLAUDE.md minimal-deps rule gets amended.

## What stays untouched

- `src/core/workbench.ts`, reducer, persistence, `PartVariation` model — the canvas consumes `buildPartTrees` output.
- `MutationBay.tsx`'s state, `effFocus` repair, `applySelection`/`engine.swap`, generation handlers, rebase/prune/promote, `moveFocus` DFS, the single window-keydown via `keydownRef` (MutationBay.tsx:504-512), transport header, footer.
- `AdvancedPop.tsx` (its bay-controlled/`closeOnEscape={false}` contract holds).
- e2e selectors: `.tree-node`, `.node-badge`, `.in-mix`, `Use` buttons (e2e/triage.spec.ts:115-148, e2e/persistence.spec.ts:25-57) — node components keep these class names by design.

## Implementation steps

### 1. Deps + CLAUDE.md
`npm i @xyflow/react @dagrejs/dagre`. Amend CLAUDE.md: permitted-libraries list, runtime-deps line, and the Mutation Bay paragraph ("Results nest rightward as a tree (CSS elbow connectors…)" → single React Flow canvas, dagre LR lanes, non-draggable, no persisted positions).

### 2. Extractions (pure move, app keeps working)
- `ClaudePop` (PartRow.tsx:55) → `src/components/bay/ClaudePop.tsx`.
- `provenanceLabel` + `BayFocus` (PartRow.tsx:11,18 — imported by MutationBay) → `src/components/bay/bayTypes.ts`.

### 3. New `src/components/bay/flow/`

**`layout.ts`** — pure, no React (unit-testable in node env). Single source of node size constants mirroring the CSS (origin 230w / origin-mini 172w; take by depth 176/162/154w with matching heights; take-mini 84×34; pending 176×84; LANE_GAP 28, RANKSEP 40, NODESEP 12). `layoutBay({trees, showHidden, collapsedParts, pending}) → {positions: Map<id,{x,y,w,h}>, laneBottoms}`:
- **One dagre graph per part** (`rankdir:'LR'`), lanes stacked by running vertical offset — no cross-part edges exist, so per-part graphs keep every origin at rank 0 / x=0.
- Visibility rule matches today's `TreeColumn`/`moveFocus` `vis()`: a hidden node prunes its subtree when `!showHidden`.
- Pending placeholders placed under their `parentNodeId` (or origin). Collapsed part → mini sizes for the whole lane. Dagre centers → React Flow top-left coords.

**`graph.ts`** — `buildFlowGraph(...)` → nodes+edges. Node types `origin` (`origin:{part}`), `take` (id = variation.id), `pending` (`pending:{key}`); data carries plain facts only (part, variation, depth, mini, focused, inMix, ghost, advOpen…). Edges `type:'smoothstep'`, `pathOptions:{borderRadius:4}` (reads as the old elbow look). Everything `draggable:false / selectable:false / connectable:false`, explicit `width`/`height` from layout constants so dagre input and rendered size can't drift. Rebuilt in one `useMemo` in MutationBay keyed on `[trees, selection, effFocus, showHidden, collapsedParts, pending, advanced]`.

**`BayFlowContext.tsx`** — context carrying the callbacks today's `RowCallbacks` closures carried (applySelection, mutateGa, runMutation, applyPartTransform, rollSound, focusNode, ADV toggle/close, toggleCollapse) plus `source`, `mixId`, `claudeReady`, `busyParts`, `showHidden`. Keeps callbacks OUT of node data so memoized node components only re-render on their own facts.

**Node components** — `TakeNode.tsx` is today's `NodeCard` (PartRow.tsx:126-261) moved nearly verbatim: same class names (`tree-node depth-{n} mini focused in-mix ghost`), same `node-head`/`LcdRoll`/`node-foot` with MUTATE/ClaudePop/AdvancedPop, same `lcdMotif` memo. Changes: props via `NodeProps` + context; **delete the `scrollIntoView` effect** (PartRow.tsx:163); add invisible `<Handle>`s (target left / source right, `isConnectable={false}`); root fills 100%. `OriginNode.tsx` = origin-cell JSX (PartRow.tsx:443-561, both branches, sound dice, collapse caret) minus its scrollIntoView (PartRow.tsx:412), source handle only. `PendingNode.tsx` = dashed pulsing placeholder. `nodeTypes` at **module scope** (v12 stable-reference requirement).

**`BayFlowCanvas.tsx`** — imports `@xyflow/react/dist/style.css` once;
```
nodesDraggable={false} nodesConnectable={false} nodesFocusable={false}
edgesFocusable={false} elementsSelectable={false} disableKeyboardA11y
deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
panActivationKeyCode={null}          // Space stays "loop mix"
panOnScroll panOnDrag zoomOnScroll={false} zoomOnPinch zoomOnDoubleClick={false}
preventScrolling minZoom={0.4} maxZoom={1.5}
fitView fitViewOptions={{padding:0.15, maxZoom:1}}
onMoveStart={onCloseAdvanced}        // popover anti-drift, step 7
```
Keep the React Flow attribution (restyled to tokens). `<Background>` dots + `<MiniMap pannable zoomable>` (ComfyUI touch), both restyled. `onlyRenderVisibleElements` OFF for v1 (would unmount open popovers); note as perf lever.

### 4. `MutationBay.tsx` rewiring
Replace the `rowParts.map(<PartRow/>)` block (MutationBay.tsx:596+) with `<div className="bay-canvas"><ReactFlowProvider><BayFlowContext.Provider>…<BayFlowCanvas/>` . `rowParts` stays (transport mix chips use it, MutationBay.tsx:545). Add `focusSourceRef: 'keyboard'|'pointer'` (set in `moveFocus` vs click path) so the canvas only auto-pans on keyboard focus moves. Delete `PartRow.tsx` at the end.

### 5. Focus follow (replaces scrollIntoView)
Effect in `BayFlowCanvas` keyed on `effFocus`: resolve node id (`focus.nodeId ?? origin:{part}`); if keyboard-driven and the node isn't fully visible, pan the viewport by the **minimal translation** (nearest-edge semantics like `scrollIntoView({block:'nearest'})`) at current zoom, `{duration:150}` (inside the ≤180ms no-springy-motion budget). Fallback: `setCenter`. Never pan on pointer focus.

### 6. CSS (`styles.css` bay section, ~1794-2278)
- **Delete**: `.part-row`, `.part-row-scroll`, `.tree-children`, `.tree-node-wrap` + all elbow `::before/::after` rules (2071-2132), `.part-row.compact` connector overrides; drop `position:sticky` from `.origin-cell` (keep the card look).
- **Keep**: `.tree-node` + state classes, `.node-head/.node-badge/.node-foot`, `.origin-*`, `.bay-transport`, `.bay-footer`, `.mix-chip`.
- **Add**: `.bay{height:100%}`, `.wb-drawer-body{overflow:hidden}`, transport/footer become static flex children, and a `.bay-canvas` block — `flex:1; min-height:0; border:1px solid var(--module-border); border-radius:12px; overflow:hidden; background:var(--tray-bg)` — plus token-based overrides for `.react-flow__background circle` (fill `var(--faint)` — use CSS, not the `color` prop, so day/nite flips work), `__edge-path` (stroke `var(--faint)`), `__handle` (invisible, no pointer events), `__attribution`, `__minimap*`. `.tree-node,.origin-cell{width:100%;height:100%}` to fill the sized flow node.

### 7. Mantine popovers on a transformed canvas
Mantine positions via Floating UI against `getBoundingClientRect()`, which accounts for CSS transforms — dropdowns anchor correctly at any zoom and render at page scale (good: readable when zoomed out). One gap: pan/zoom is a transform change, not scroll, so an open dropdown won't reposition — hence `onMoveStart → onCloseAdvanced` (ADV is bay-controlled already). ClaudePop keeps local open state; ESC/blur already cover it. No zoom lock, no `withinPortal:false`.

## Implementation order
1. Deps + CLAUDE.md → 2. extractions → 3. `flow/layout.ts` (+ `tests/bayFlowLayout.test.ts`: lane stacking, visibility pruning, collapsed sizes, pending placement) → 4. `graph.ts`/context/node components/canvas → 5. swap into MutationBay, delete PartRow → 6. CSS pass → 7. focus-follow + onMoveStart.

## Verification
- `npm run build` (tsc strict — watch v12 `NodeProps`/`Node<Data,Type>` generics), `npm test` (+ new layout test), `npm run lint`.
- `npm run test:e2e` — triage.spec.ts:115-148 (ADV→Invert→`.tree-node`/`.node-badge`→Use→promote), :220-251 (Space loop, ESC cascade), persistence.spec.ts:25-57 (`.tree-node.in-mix` after reload). Selectors preserved; `fitViewOptions.maxZoom:1` keeps small trees at 1:1 so Playwright clicks land.
- Per Joe's preference (no self-testing): run the build/test/lint gates; he'll drive the app himself. Manual checklist: day↔nite flip with bay open; Space never pans; arrows walk lanes with ≤150ms follow-pan; Enter mid-loop still hot-swaps; `c` collapse → mini lane relayout; SHOW HIDDEN ghosts + edges; pending Claude node pulses in place; ADV at zoom 0.5 anchors and closes on pan; drum lane hides the dice; partless motif = one lane.
