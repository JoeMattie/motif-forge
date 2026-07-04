import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Divider, Group, Kbd, Mark, Stack, Tooltip } from '@mantine/core'
import { XIcon } from '@phosphor-icons/react'
import type { Motif, PartVariation, Sound, SynthPreset } from '../types'
import { parentIdOf } from '../types'
import { applyTransform, describeTransform, type Transform } from '../core/transforms'
import {
  buildPartTrees,
  compositeMotif,
  compositeNotes,
  contextMotifForNode,
  partCountOf,
  partNotes,
  pruneIds,
  rebaseHiddenIds,
  selectionFor,
  variationsFromChildren,
  variedPartIndices,
  type PartTreeNode,
} from '../core/workbench'
import { mutateBatch } from '../api/generate'
import { enqueue } from '../api/queue'
import { mutateNotes, randomSeed } from '../generation/symbolic'
import { mulberry32 } from '../generation/symbolic/prng'
import { engine } from '../audio/engine'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { newId } from '../core/ids'
import { useClaudeReady } from '../uiPrefs'
import { useIsLoading, useIsPlaying } from './hooks/usePlayhead'
import { isTypingTarget } from './hooks/useKeyboardTriage'
import { usePlayOptions } from './hooks/usePlayOptions'
import { LcdRoll } from './LcdRoll'
import { PlayRound } from './hw/PlayRound'
import { provenanceLabel, type BayFocus } from './bay/bayTypes'
import {
  BayFlowProvider,
  type BayFlowCallbacks,
  type BayFlowContextValue,
} from './bay/flow/BayFlowContext'
import { BayFlowCanvas } from './bay/flow/BayFlowCanvas'
import { buildFlowGraph } from './bay/flow/graph'
import { layoutBay, originNodeId } from './bay/flow/layout'
import {
  loadBayPositions,
  saveBayPositions,
  type BayNodePositions,
} from './bay/flow/nodePositions'

function lineageChain(motif: Motif, motifs: Map<string, Motif>): Motif[] {
  const chain: Motif[] = [motif]
  let cursor = motif
  for (let guard = 0; guard < 50; guard++) {
    const pid = parentIdOf(cursor)
    if (!pid) break
    const parent = motifs.get(pid)
    if (!parent) break
    chain.unshift(parent)
    cursor = parent
  }
  return chain
}

function lineageLabel(m: Motif): string {
  switch (m.source.kind) {
    case 'seed':
      return 'SEED'
    case 'generated':
      return 'GEN BATCH'
    case 'transform':
      return m.source.transform.toUpperCase().slice(0, 18)
    case 'llm-mutation':
      return 'LLM VAR'
    case 'bay-mix':
      return 'MIX'
    case 'symbolic':
      return 'WALK'
    case 'ga':
      return m.source.parentIds.length > 1 ? 'EVO CROSS' : 'EVO'
    case 'neural':
      return 'NEURAL'
    case 'genetic':
      return 'RIFF'
    case 'recorded':
      return m.source.input === 'mic'
        ? 'MIC'
        : m.source.input === 'pencil'
          ? 'PENCIL'
          : m.source.input === 'clip'
            ? 'CLIP'
            : 'PLAYED'
  }
}

interface PendingBatch {
  key: string
  part: number
  parentNodeId: string | null
}

const SOUNDS: Sound[] = ['synth', 'piano', 'epiano', 'marimba', 'strings']
const OSCILLATORS: SynthPreset['oscillator'][] = ['sine', 'triangle', 'sawtooth', 'square']

/** A fresh patch for dice rolls that land on 'synth', within validation's clamps. */
function randomPreset(rng: () => number): SynthPreset {
  const pick = (lo: number, hi: number) => lo + rng() * (hi - lo)
  return {
    oscillator: OSCILLATORS[Math.floor(rng() * OSCILLATORS.length)],
    envelope: {
      attack: pick(0.001, 0.2),
      decay: pick(0.05, 0.5),
      sustain: pick(0.1, 0.8),
      release: pick(0.05, 1),
    },
  }
}

/** Takes branching from a re-sounded take keep its sound, so a whole branch
 * stays on the instrument it was rolled onto. */
function inheritSound(v: PartVariation, node: PartVariation | null): PartVariation {
  if (!node?.instrument) return v
  const out: PartVariation = { ...v, instrument: node.instrument }
  if (node.preset) out.preset = node.preset
  return out
}

/**
 * Mutation Bay — a per-part variation workspace scoped to ONE source motif.
 * One row per part; MUTATE grows a tree of instant GA takes to the right,
 * CLAUDE asks for a targeted LLM rewrite, ADV drops down part-scoped
 * deterministic transforms. Enter picks one take per part, Space loops the
 * composite mix, and PROMOTE lands the mix in the family.
 */
export function MutationBay({ source }: { source: Motif }) {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const playOpts = usePlayOptions()
  const claudeReady = useClaudeReady()

  const hasParts = source.parts.length > 0
  const partCount = partCountOf(source)
  const mixId = `${source.id}::mix`
  const mixPlaying = useIsPlaying(mixId)
  const mixLoading = useIsLoading(mixId)

  const trees = useMemo(
    () => buildPartTrees(source, state.partVariations),
    [source, state.partVariations],
  )
  const selection = useMemo(
    () => selectionFor(state.partVariations, source.id),
    [state.partVariations, source.id],
  )
  const mix = useMemo(() => compositeMotif(source, selection, mixId), [source, selection, mixId])

  const [focus, setFocus] = useState<BayFocus>({ part: 0, nodeId: null })
  const [advanced, setAdvanced] = useState<BayFocus | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [collapsedParts, setCollapsedParts] = useState<Set<number>>(() => new Set())
  const [pending, setPending] = useState<PendingBatch[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [pruneArmed, setPruneArmed] = useState(false)
  const pruneTimer = useRef<number | null>(null)
  /** What moved the focus last: only keyboard moves auto-pan the canvas. */
  const focusSourceRef = useRef<'keyboard' | 'pointer'>('pointer')

  useEffect(
    () => () => {
      if (pruneTimer.current !== null) clearTimeout(pruneTimer.current)
    },
    [],
  )

  // Focus may point at a node that was pruned or hidden since — fall back to
  // the row's origin cell instead of a dangling cursor. Memoized so the flow
  // graph rebuild only fires when the effective focus actually changes.
  const effFocus: BayFocus = useMemo(() => {
    if (focus.part >= partCount) return { part: 0, nodeId: null }
    const focusedVariation = focus.nodeId ? state.partVariations.get(focus.nodeId) : undefined
    return focus.nodeId && (!focusedVariation || (focusedVariation.hidden && !showHidden))
      ? { part: focus.part, nodeId: null }
      : focus
  }, [focus, partCount, state.partVariations, showHidden])

  const focusNode = (part: number, nodeId: string | null) => {
    setFocus({ part, nodeId })
    // The advanced panel follows the focused take within its own row.
    setAdvanced((a) => (a && a.part === part ? { part, nodeId } : a))
  }

  const toggleCollapse = (part: number) => {
    setCollapsedParts((prev) => {
      const next = new Set(prev)
      if (next.has(part)) next.delete(part)
      else next.add(part)
      return next
    })
  }

  const partName = (i: number) => (hasParts ? (source.parts[i]?.name ?? `part ${i}`) : 'all')
  const partIsDrums = (i: number) => hasParts && source.parts[i]?.instrument === 'drums'

  // ---- playback ----

  const toggleMix = () => {
    if (engine.getSnapshot().playingMotifId !== null) engine.stop()
    else engine.play(mix, playOpts(mix, { loop: true }))
  }

  /** Select a take into the mix (null = original). While the mix loops, the
   * new take swaps in immediately via the engine's mid-flight swap — pending
   * notes cancel, whatever is sounding rings out. */
  const applySelection = (part: number, node: PartVariation | null) => {
    const cur = selection.get(part) ?? null
    const updates: PartVariation[] = []
    if (node === null) {
      if (!cur) return
      updates.push({ ...cur, selected: false })
    } else {
      if (cur?.id === node.id) return
      if (cur) updates.push({ ...cur, selected: false })
      updates.push({ ...node, selected: true, hidden: false })
    }
    dispatch({ type: 'PART_VARIATIONS_UPSERT', variations: updates })

    const nextSel = new Map(selection)
    if (node === null) nextSel.delete(part)
    else nextSel.set(part, node)
    const nextMix = compositeMotif(source, nextSel, mixId)

    if (engine.getSnapshot().playingMotifId === mixId) {
      engine.swap(nextMix, playOpts(nextMix, { loop: true }))
    }
  }

  // ---- generation ----

  const runMutation = (part: number, node: PartVariation | null, brief: string) => {
    const key = newId()
    const parentNodeId = node?.id ?? null
    setPending((p) => [...p, { key, part, parentNodeId }])
    setMessage(null)
    const ctx = contextMotifForNode(source, selection, part, node)
    const lockedParts = hasParts
      ? source.parts.map((_, i) => i).filter((i) => i !== part)
      : undefined
    void enqueue(() => mutateBatch(ctx, brief, 1, { lockedParts }))
      .then((result) => {
        const vs = variationsFromChildren(
          result.valid,
          source,
          part,
          parentNodeId,
          { kind: 'llm', brief },
          newId,
          Date.now(),
        ).map((v) => inheritSound(v, node))
        if (vs.length > 0) dispatch({ type: 'PART_VARIATIONS_UPSERT', variations: vs })
        const dropped = result.droppedCount + (result.valid.length - vs.length)
        setMessage(
          `+${vs.length} takes on ${partName(part)}${dropped > 0 ? ` · ${dropped} dropped` : ''}`,
        )
      })
      .catch((e) => setMessage(`Mutation failed: ${String(e).slice(0, 120)}`))
      .finally(() => setPending((p) => p.filter((x) => x.key !== key)))
  }

  /** MUTATE: one instant offline GA take — a small seeded in-scale edit
   * (rhythm-only ops on drum parts), branching from the focused take. Each
   * press adds one more sibling. No API involved. */
  const mutateGa = (part: number, node: PartVariation | null) => {
    const take = node ? node.notes : partNotes(source, part)
    if (take.length === 0) {
      setMessage(`Nothing to evolve — ${partName(part)} has no notes`)
      return
    }
    const drums = partIsDrums(part)
    const seed = randomSeed()
    const { notes, ops } = mutateNotes(take, source, mulberry32(seed), { drums })
    const variation: PartVariation = inheritSound(
      {
        id: newId(),
        sourceMotifId: source.id,
        partIndex: part,
        parentNodeId: node?.id ?? null,
        notes,
        provenance: { kind: 'ga', ops: ops.join('+'), seed },
        selected: false,
        hidden: false,
        createdAt: Date.now(),
      },
      node,
    )
    dispatch({ type: 'PART_VARIATIONS_UPSERT', variations: [variation] })
    setMessage(`+1 evolved take on ${partName(part)}`)
  }

  const applyPartTransform = (part: number, node: PartVariation | null, t: Transform) => {
    const take = node ? node.notes : partNotes(source, part)
    const child = applyTransform({ ...source, id: `take:${source.id}:${part}`, notes: take }, t)
    dispatch({
      type: 'PART_VARIATIONS_UPSERT',
      variations: [
        inheritSound(
          {
            id: newId(),
            sourceMotifId: source.id,
            partIndex: part,
            parentNodeId: node?.id ?? null,
            notes: child.notes,
            provenance: { kind: 'transform', transform: describeTransform(t) },
            selected: false,
            hidden: false,
            createdAt: Date.now(),
          },
          node,
        ),
      ],
    })
  }

  /** Dice: one new take that keeps the part's notes but plays them on a
   * random OTHER sound (a fresh random patch when it lands on synth). It goes
   * straight into the mix so the roll is instantly audible; repeated rolls
   * land as siblings (a sound take never chains under another sound take). */
  const rollSound = (part: number) => {
    if (!hasParts || partIsDrums(part)) return
    const sel = selection.get(part) ?? null
    const current = sel?.instrument ?? source.parts[part]?.instrument ?? 'synth'
    const rng = mulberry32(randomSeed())
    const pool = SOUNDS.filter((s) => s !== current)
    const instrument = pool[Math.floor(rng() * pool.length)]
    const variation: PartVariation = {
      id: newId(),
      sourceMotifId: source.id,
      partIndex: part,
      parentNodeId: sel?.provenance.kind === 'sound' ? sel.parentNodeId : (sel?.id ?? null),
      notes: sel ? sel.notes : partNotes(source, part),
      provenance: { kind: 'sound', instrument },
      instrument,
      selected: false,
      hidden: false,
      createdAt: Date.now(),
    }
    if (instrument === 'synth') variation.preset = randomPreset(rng)
    dispatch({ type: 'PART_VARIATIONS_UPSERT', variations: [variation] })
    applySelection(part, variation)
    setMessage(`${partName(part)} → ${instrument}`)
  }

  // ---- tree housekeeping ----

  const rebase = () => {
    const ids = rebaseHiddenIds(state.partVariations, source.id)
    if (ids.length === 0) {
      setMessage('Nothing to rebase — every take is on a selected path')
      return
    }
    const variations = ids
      .map((id) => state.partVariations.get(id))
      .filter((v): v is PartVariation => v !== undefined)
      .map((v) => ({ ...v, hidden: true }))
    dispatch({ type: 'PART_VARIATIONS_UPSERT', variations })
    setMessage(`${ids.length} takes hidden — SHOW HIDDEN to bring them back, PRUNE to drop them`)
  }

  const unhideAll = () => {
    const variations = [...state.partVariations.values()]
      .filter((v) => v.sourceMotifId === source.id && v.hidden)
      .map((v) => ({ ...v, hidden: false }))
    if (variations.length > 0) dispatch({ type: 'PART_VARIATIONS_UPSERT', variations })
  }

  const prune = () => {
    if (!pruneArmed) {
      setPruneArmed(true)
      if (pruneTimer.current !== null) clearTimeout(pruneTimer.current)
      pruneTimer.current = window.setTimeout(() => setPruneArmed(false), 3000)
      return
    }
    setPruneArmed(false)
    if (pruneTimer.current !== null) clearTimeout(pruneTimer.current)
    const ids = pruneIds(state.partVariations, source.id)
    if (ids.length === 0) {
      setMessage('Nothing to prune')
      return
    }
    dispatch({ type: 'PART_VARIATIONS_DELETED', ids })
    if (focus.nodeId && ids.includes(focus.nodeId)) setFocus({ part: focus.part, nodeId: null })
    setMessage(`${ids.length} takes pruned`)
  }

  const promote = () => {
    if (selection.size === 0) return
    const promoted: Motif = {
      ...source,
      id: newId(),
      name: `${source.name} mix`,
      parts: mix.parts, // carries any dice-rolled sound overrides
      notes: compositeNotes(source, selection),
      rating: 0,
      discarded: false,
      promoted: false,
      trackId: null,
      rationale: undefined,
      createdAt: Date.now(),
      source: { kind: 'bay-mix', parentId: source.id, variedParts: variedPartIndices(selection) },
    }
    dispatch({ type: 'MOTIFS_ADDED', motifs: [promoted] })
    setMessage(`Promoted "${promoted.name}" into the family`)
  }

  // ---- keyboard ----

  const closeBay = () => {
    engine.stop()
    dispatch({ type: 'SET_MUTATION_TARGET', id: null })
  }

  type FindResult = { parent: string | null; siblings: PartTreeNode[]; node: PartTreeNode }
  const findPath = (
    nodes: PartTreeNode[],
    id: string,
    parent: string | null,
  ): FindResult | null => {
    for (const n of nodes) {
      if (n.variation.id === id) return { parent, siblings: nodes, node: n }
      const r = findPath(n.children, id, n.variation.id)
      if (r) return r
    }
    return null
  }
  const vis = (ns: PartTreeNode[]) => ns.filter((n) => showHidden || !n.variation.hidden)

  const moveFocus = (dir: 'up' | 'down' | 'left' | 'right') => {
    focusSourceRef.current = 'keyboard'
    const { part, nodeId } = effFocus
    // Arrows match the layout: mutations sit side by side, children hang
    // below their parent. Down descends into the children row, Up climbs
    // back to the parent (origin at the root generation).
    if (dir === 'down') {
      const targets =
        nodeId === null
          ? vis(trees[part] ?? [])
          : vis(findPath(trees[part] ?? [], nodeId, null)?.node.children ?? [])
      if (targets[0]) focusNode(part, targets[0].variation.id)
      return
    }
    if (dir === 'up') {
      if (nodeId !== null) {
        focusNode(part, findPath(trees[part] ?? [], nodeId, null)?.parent ?? null)
      }
      return
    }
    // Right/Left walk EVERY visible take of a row in visual (depth-first)
    // order — only past the last one does the cursor cross to the next
    // instrument. Collapsed rows keep their takes navigable (mini boxes).
    const delta = dir === 'right' ? 1 : -1
    const dfs = (ns: PartTreeNode[]): string[] =>
      vis(ns).flatMap((n) => [n.variation.id, ...dfs(n.children)])
    const seq: BayFocus[] = []
    for (let p = 0; p < partCount; p++) {
      seq.push({ part: p, nodeId: null })
      for (const id of dfs(trees[p] ?? [])) seq.push({ part: p, nodeId: id })
    }
    const idx = seq.findIndex((f) => f.part === part && f.nodeId === nodeId)
    const ni = idx + delta
    if (idx >= 0 && ni >= 0 && ni < seq.length) focusNode(seq[ni].part, seq[ni].nodeId)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Escape') {
      // ESC walks out: text field → open ADV dropdown → the bay itself
      if (isTypingTarget(e.target)) {
        ;(e.target as HTMLElement).blur()
        return
      }
      if (advanced) {
        setAdvanced(null)
        return
      }
      closeBay()
      return
    }
    if (isTypingTarget(e.target)) return
    const focusedNode = effFocus.nodeId
      ? (state.partVariations.get(effFocus.nodeId) ?? null)
      : null
    switch (e.key) {
      case ' ':
        e.preventDefault()
        toggleMix()
        break
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault()
        moveFocus(e.key.slice(5).toLowerCase() as 'up' | 'down' | 'left' | 'right')
        break
      case 'Enter':
        e.preventDefault()
        applySelection(effFocus.part, focusedNode)
        break
      case 'm':
        mutateGa(effFocus.part, focusedNode)
        break
      case 's':
        rollSound(effFocus.part)
        break
      case 'a':
        setAdvanced((a) =>
          a?.part === effFocus.part ? null : { part: effFocus.part, nodeId: effFocus.nodeId },
        )
        break
      case 'c':
        toggleCollapse(effFocus.part)
        break
      case 'p':
        promote()
        break
      default:
        break
    }
  }
  // The handler closes over fresh state every render; route the window
  // listener through a ref so it's attached exactly once instead of being
  // torn down and re-added on every render.
  const keydownRef = useRef(onKeyDown)
  useEffect(() => {
    keydownRef.current = onKeyDown
  })
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keydownRef.current(e)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ---- render ----

  const chain = lineageChain(source, state.motifs)
  const rowParts = useMemo(
    () =>
      hasParts
        ? source.parts.map((p, i) => ({
            name: p.name,
            instrument: p.instrument === 'drums' ? 'GM kit' : p.instrument,
            isDrums: p.instrument === 'drums',
            index: i,
          }))
        : [{ name: 'all', instrument: 'transport sound', isDrums: false, index: 0 }],
    [hasParts, source.parts],
  )
  const originNotes = useMemo(
    () => Array.from({ length: partCount }, (_, i) => partNotes(source, i)),
    [source, partCount],
  )

  // ---- the shared canvas: dagre layout → flow graph → context ----

  // Hand-dragged card positions override their dagre slot; persisted per
  // source motif in localStorage (the bay remounts per source via its key).
  const [draggedPositions, setDraggedPositions] = useState<BayNodePositions>(() =>
    loadBayPositions(source.id),
  )

  const layout = useMemo(() => {
    const l = layoutBay({ trees, showHidden, collapsedParts, pending })
    for (const [id, p] of Object.entries(draggedPositions)) {
      const rect = l.positions.get(id)
      if (rect) l.positions.set(id, { ...rect, x: p.x, y: p.y })
    }
    return l
  }, [trees, showHidden, collapsedParts, pending, draggedPositions])

  // Only the drop persists — while the drag is in flight React Flow moves the
  // card via the canvas's local applyNodeChanges state, so no dagre relayout
  // or graph rebuild runs per pointermove.
  const onNodeDragStop = (id: string, pos: { x: number; y: number }) => {
    // prune overrides for nodes that no longer exist (pruned takes, vanished
    // pending parents) so the stored map can't grow stale entries
    const next: BayNodePositions = {}
    for (const [k, v] of Object.entries({ ...draggedPositions, [id]: pos })) {
      if (layout.positions.has(k)) next[k] = v
    }
    setDraggedPositions(next)
    saveBayPositions(source.id, next)
  }
  const graph = useMemo(
    () =>
      buildFlowGraph({
        parts: rowParts,
        trees,
        layout,
        selection,
        focus: effFocus,
        advanced,
        showHidden,
        collapsedParts,
        pending,
        hasParts,
        originNotes,
      }),
    [
      rowParts,
      trees,
      layout,
      selection,
      effFocus,
      advanced,
      showHidden,
      collapsedParts,
      pending,
      hasParts,
      originNotes,
    ],
  )

  // Node components read callbacks from context, not node data. The handlers
  // close over fresh state every render, so — exactly like the keydown
  // listener — they route through a ref and the context object stays stable.
  const liveCallbacks: BayFlowCallbacks = {
    focusNode: (part, nodeId) => {
      focusSourceRef.current = 'pointer'
      focusNode(part, nodeId)
    },
    applySelection,
    mutateGa,
    runMutation,
    applyPartTransform,
    rollSound,
    toggleAdvanced: (part, nodeId) => {
      // plain setFocus, not focusNode — focusNode drags an open ADV
      // dropdown onto this take first, which would make the toggle
      // read as "already open" and close it instead of moving it
      focusSourceRef.current = 'pointer'
      setFocus({ part, nodeId })
      setAdvanced((a) => (a?.part === part && a.nodeId === nodeId ? null : { part, nodeId }))
    },
    closeAdvanced: () => setAdvanced(null),
    toggleCollapse,
  }
  const callbacksRef = useRef(liveCallbacks)
  useEffect(() => {
    callbacksRef.current = liveCallbacks
  })
  const stableCallbacks = useMemo<BayFlowCallbacks>(
    () => ({
      focusNode: (part, nodeId) => callbacksRef.current.focusNode(part, nodeId),
      applySelection: (part, node) => callbacksRef.current.applySelection(part, node),
      mutateGa: (part, node) => callbacksRef.current.mutateGa(part, node),
      runMutation: (part, node, brief) => callbacksRef.current.runMutation(part, node, brief),
      applyPartTransform: (part, node, t) => callbacksRef.current.applyPartTransform(part, node, t),
      rollSound: (part) => callbacksRef.current.rollSound(part),
      toggleAdvanced: (part, nodeId) => callbacksRef.current.toggleAdvanced(part, nodeId),
      closeAdvanced: () => callbacksRef.current.closeAdvanced(),
      toggleCollapse: (part) => callbacksRef.current.toggleCollapse(part),
    }),
    [],
  )
  const bayCtx = useMemo<BayFlowContextValue>(
    () => ({ source, mixId, claudeReady, callbacks: stableCallbacks }),
    [source, mixId, claudeReady, stableCallbacks],
  )

  return (
    <div className="bay">
      <section className="module bay-module bay-transport">
        <Group gap={12} wrap="nowrap">
          <Tooltip label="Play/stop the mix — selected takes per part, looped (Space)">
            <PlayRound size="lg" playing={mixPlaying} loading={mixLoading} onClick={toggleMix} />
          </Tooltip>
          <Stack gap={2} style={{ minWidth: 0 }}>
            <span className="bay-title">{source.name}</span>
            <span className="micro-dim" style={{ whiteSpace: 'nowrap' }}>
              mix · {source.key} {source.mode.slice(0, 3)} · {source.bars}B · {source.tempo} BPM
            </span>
            <span className="kbd-legend" style={{ whiteSpace: 'nowrap' }}>
              <Kbd>space</Kbd> loop mix
            </span>
          </Stack>
          <Divider orientation="vertical" />
          {/* what the mix currently plays, part by part */}
          <Stack gap={4} align="flex-start" style={{ flex: 1, minWidth: 0 }}>
            {rowParts.map((p) => {
              const sel = selection.get(p.index)
              return (
                <Tooltip
                  key={p.index}
                  label={
                    sel
                      ? 'This part plays the selected take — Enter on its origin cell reverts'
                      : 'This part plays the original'
                  }
                >
                  <Badge
                    size="sm"
                    radius="sm"
                    variant="outline"
                    className={`mix-chip${sel ? ' swapped' : ''}${p.isDrums ? ' drums' : ''}`}
                  >
                    {p.name}: {sel ? provenanceLabel(sel) : 'original'}
                  </Badge>
                </Tooltip>
              )
            })}
          </Stack>
          <Divider orientation="vertical" />
          {/* the combined mix: every part at its currently selected take */}
          <div style={{ flex: '0 0 50%', minWidth: 0 }}>
            <LcdRoll motif={mix} height={96} />
          </div>
        </Group>
        <div className="lineage-row">
          <span style={{ letterSpacing: '.14em', color: 'var(--faint)' }}>Lineage</span>
          {chain.map((m, i) => (
            <span key={m.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <span className="lineage-arrow">→</span>}
              <Tooltip label={m.name}>
                <button
                  type="button"
                  className="lineage-chip"
                  data-current={m.id === source.id}
                  onClick={() =>
                    m.id !== source.id && dispatch({ type: 'SET_MUTATION_TARGET', id: m.id })
                  }
                >
                  {m.id === source.id ? 'THIS' : lineageLabel(m)}
                </button>
              </Tooltip>
            </span>
          ))}
        </div>
      </section>

      <div className="bay-canvas">
        <BayFlowProvider value={bayCtx}>
          <BayFlowCanvas
            nodes={graph.nodes}
            edges={graph.edges}
            focusKey={`${effFocus.part}:${effFocus.nodeId ?? 'origin'}`}
            focusRect={layout.positions.get(effFocus.nodeId ?? originNodeId(effFocus.part)) ?? null}
            focusSource={focusSourceRef}
            advOpen={advanced !== null}
            // pan/zoom moves the anchor under a fixed dropdown — close ADV
            onMoveStart={stableCallbacks.closeAdvanced}
            onNodeDragStop={onNodeDragStop}
          />
        </BayFlowProvider>
      </div>

      <div className="bay-footer">
        <Tooltip label="Hide every take that isn't on a selected path — reversible with SHOW HIDDEN">
          <Button onClick={rebase}>Rebase</Button>
        </Tooltip>
        <Tooltip label="Reveal hidden takes (ghosted) so they can be reselected">
          <Button data-latched={showHidden} onClick={() => setShowHidden((s) => !s)}>
            Show hidden
          </Button>
        </Tooltip>
        {showHidden && <Button onClick={unhideAll}>Unhide all</Button>}
        <Tooltip label="Permanently delete hidden takes and everything off the selected paths">
          <Button data-danger={pruneArmed} onClick={prune}>
            {pruneArmed ? 'Prune — sure?' : 'Prune'}
          </Button>
        </Tooltip>
        {message && <span className="micro-dim bay-message">{message}</span>}
        <span className="spacer" />
        <span className="kbd-legend">
          <Kbd>space</Kbd> play · <Kbd>enter</Kbd> use take · <Mark className="hk">m</Mark>utate ·{' '}
          <Mark className="hk">a</Mark>dvanced · <Mark className="hk">s</Mark>ound ·{' '}
          <Mark className="hk">p</Mark>romote
        </span>
        <Button
          aria-label="Close bay"
          onClick={closeBay}
          leftSection={<XIcon size={10} />}
        >
          <span>
            Close · <Kbd>esc</Kbd>
          </span>
        </Button>
        <Tooltip
          label={
            selection.size === 0
              ? 'Select at least one take (Enter) — the mix currently equals the source'
              : 'Add the current mix to the family as a new take'
          }
        >
          <button type="button" className="promote-big" disabled={selection.size === 0} onClick={promote}>
            Promote mix
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
