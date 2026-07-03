import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Divider, Group, Kbd, Mark, Stack, Tooltip } from '@mantine/core'
import { XIcon } from '@phosphor-icons/react'
import type { Motif, PartVariation } from '../types'
import { parentIdOf } from '../types'
import { beatsPerBar } from '../core/theory'
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
import { partMutationBrief } from '../api/prompts'
import { engine } from '../audio/engine'
import { effectiveTempo } from '../store/appState'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { newId } from '../core/ids'
import { useIsLoading, useIsPlaying } from './hooks/usePlayhead'
import { isTypingTarget } from './hooks/useKeyboardTriage'
import { usePlayOptions } from './hooks/usePlayOptions'
import { LcdRoll } from './LcdRoll'
import { PlayRound } from './hw/PlayRound'
import { AdvancedPanel } from './bay/AdvancedPanel'
import { PartRow, provenanceLabel, type BayFocus } from './bay/PartRow'

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
  }
}

interface PendingBatch {
  key: string
  part: number
  parentNodeId: string | null
}

/**
 * Mutation Bay — a per-part variation workspace scoped to ONE source motif.
 * One row per part; MUTATE grows a tree of LLM takes to the right, ADVANCED
 * adds transforms + a custom brief. Enter picks one take per part, Space
 * loops the composite mix, and PROMOTE lands the mix in the family.
 */
export function MutationBay({ source }: { source: Motif }) {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const playOpts = usePlayOptions()

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
  const [collapsedParts, setCollapsedParts] = useState<Set<number>>(new Set())
  const [pending, setPending] = useState<PendingBatch[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [pruneArmed, setPruneArmed] = useState(false)
  const swapTimer = useRef<number | null>(null)
  const pruneTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (swapTimer.current !== null) clearTimeout(swapTimer.current)
      if (pruneTimer.current !== null) clearTimeout(pruneTimer.current)
    },
    [],
  )

  // Focus may point at a node that was pruned or hidden since — fall back to
  // the row's origin cell instead of a dangling cursor.
  const focusedVariation = focus.nodeId ? state.partVariations.get(focus.nodeId) : undefined
  const effFocus: BayFocus =
    focus.part >= partCount
      ? { part: 0, nodeId: null }
      : focus.nodeId && (!focusedVariation || (focusedVariation.hidden && !showHidden))
        ? { part: focus.part, nodeId: null }
        : focus

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
   * swap lands on the next bar boundary instead of restarting the phrase. */
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

    const pos = engine.getPositionBeats()
    if (engine.getSnapshot().playingMotifId === mixId && pos !== null) {
      const bpb = beatsPerBar(source.timeSig)
      const total = source.bars * bpb
      const nextBar = Math.ceil((pos + 0.05) / bpb) * bpb
      const waitMs = ((nextBar - pos) * 60 * 1000) / effectiveTempo(state.transport, source)
      if (swapTimer.current !== null) clearTimeout(swapTimer.current)
      swapTimer.current = window.setTimeout(() => {
        if (engine.getSnapshot().playingMotifId !== mixId) return
        engine.play(nextMix, playOpts(nextMix, { loop: true, fromBeat: nextBar % total }))
      }, Math.max(0, waitMs - 90))
    }
  }

  // ---- generation ----

  const runMutation = (part: number, node: PartVariation | null, brief: string, lockRhythm = false) => {
    const key = newId()
    const parentNodeId = node?.id ?? null
    setPending((p) => [...p, { key, part, parentNodeId }])
    setMessage(null)
    const ctx = contextMotifForNode(source, selection, part, node)
    const lockedParts = hasParts
      ? source.parts.map((_, i) => i).filter((i) => i !== part)
      : undefined
    void enqueue(() => mutateBatch(ctx, brief, 5, { lockedParts, lockRhythm }))
      .then((result) => {
        const vs = variationsFromChildren(
          result.valid,
          source,
          part,
          parentNodeId,
          { kind: 'llm', brief },
          newId,
          Date.now(),
        )
        if (vs.length > 0) dispatch({ type: 'PART_VARIATIONS_UPSERT', variations: vs })
        const dropped = result.droppedCount + (result.valid.length - vs.length)
        setMessage(
          `+${vs.length} takes on ${partName(part)}${dropped > 0 ? ` · ${dropped} dropped` : ''}`,
        )
      })
      .catch((e) => setMessage(`Mutation failed: ${String(e).slice(0, 120)}`))
      .finally(() => setPending((p) => p.filter((x) => x.key !== key)))
  }

  const mutateDefault = (part: number, node: PartVariation | null) =>
    runMutation(part, node, partMutationBrief(partName(part), partIsDrums(part)))

  const applyPartTransform = (part: number, node: PartVariation | null, t: Transform) => {
    const take = node ? node.notes : partNotes(source, part)
    const child = applyTransform({ ...source, id: `take:${source.id}:${part}`, notes: take }, t)
    dispatch({
      type: 'PART_VARIATIONS_UPSERT',
      variations: [
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
      ],
    })
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

  useEffect(() => {
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
        // ESC walks out: text field → advanced panel → the bay itself
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
          mutateDefault(effFocus.part, focusedNode)
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
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  // ---- render ----

  const chain = lineageChain(source, state.motifs)
  const rowParts = hasParts
    ? source.parts.map((p, i) => ({
        name: p.name,
        instrument: p.instrument === 'drums' ? 'GM kit' : p.instrument,
        isDrums: p.instrument === 'drums',
        index: i,
      }))
    : [{ name: 'all', instrument: 'transport sound', isDrums: false, index: 0 }]

  const advancedNode = advanced?.nodeId ? (state.partVariations.get(advanced.nodeId) ?? null) : null

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
          </Stack>
          <Divider orientation="vertical" />
          {/* what the mix currently plays, part by part */}
          <Group gap={6} style={{ flex: 1, minWidth: 0 }}>
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
          </Group>
          <span className="kbd-legend" style={{ whiteSpace: 'nowrap' }}>
            <Kbd>space</Kbd> loop mix
          </span>
        </Group>
        {/* the combined mix: every part at its currently selected take */}
        <LcdRoll motif={mix} height={96} />
        <div className="lineage-row">
          <span style={{ letterSpacing: '.14em', color: 'var(--faint)' }}>Lineage</span>
          {chain.map((m, i) => (
            <span key={m.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <span className="lineage-arrow">→</span>}
              <Tooltip label={m.name}>
                <button
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

      {rowParts.map((p) => (
        <PartRow
          key={p.index}
          source={source}
          partIndex={p.index}
          partName={p.name}
          instrument={p.instrument}
          isDrums={p.isDrums}
          roots={trees[p.index] ?? []}
          originNotes={partNotes(source, p.index)}
          selectedId={selection.get(p.index)?.id ?? null}
          selectedTake={selection.get(p.index) ?? null}
          focus={effFocus.part === p.index ? effFocus : null}
          showHidden={showHidden}
          pendingParents={pending.filter((b) => b.part === p.index).map((b) => b.parentNodeId)}
          mixId={mixId}
          collapsed={collapsedParts.has(p.index)}
          onToggleCollapse={() => toggleCollapse(p.index)}
          advancedOpen={advanced?.part === p.index}
          onToggleAdvanced={() =>
            setAdvanced((a) =>
              a?.part === p.index
                ? null
                : { part: p.index, nodeId: effFocus.part === p.index ? effFocus.nodeId : null },
            )
          }
          callbacks={{
            onFocus: (nodeId) => focusNode(p.index, nodeId),
            onSelect: (node) => applySelection(p.index, node),
            onMutate: (node) => mutateDefault(p.index, node),
          }}
        >
          {advanced?.part === p.index && (
            <AdvancedPanel
              key={`${p.index}:${advanced.nodeId ?? 'origin'}`}
              source={source}
              partIndex={p.index}
              isDrums={p.isDrums}
              baseTake={advancedNode ? advancedNode.notes : partNotes(source, p.index)}
              focusLabel={advancedNode ? 'the focused take' : 'the original'}
              busy={pending.some((b) => b.part === p.index)}
              onApplyTransform={(t) => applyPartTransform(p.index, advancedNode, t)}
              onRunBrief={(brief, lockRhythm) =>
                runMutation(p.index, advancedNode, brief, lockRhythm)
              }
            />
          )}
        </PartRow>
      ))}

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
          <Kbd>space</Kbd> mix · <Kbd>enter</Kbd> use take · <Mark className="hk">m</Mark>utate ·{' '}
          <Mark className="hk">a</Mark>dvanced · <Mark className="hk">p</Mark>romote ·{' '}
          <Kbd>esc</Kbd> close
        </span>
        <Button
          aria-label="Close bay"
          onClick={closeBay}
          leftSection={<XIcon size={10} weight="bold" />}
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
          <button className="promote-big" disabled={selection.size === 0} onClick={promote}>
            Promote mix
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
