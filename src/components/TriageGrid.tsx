import { useMemo, useState } from 'react'
import { Button, Group, Kbd, Loader, Text, Tooltip } from '@mantine/core'
import { useAppState } from '../store/AppContext'
import { useGridColumns } from './hooks/useGridColumns'
import { useKeyboardTriage } from './hooks/useKeyboardTriage'
import { GenerationPanel } from './GenerationPanel'
import { MotifCard } from './MotifCard'

type Filter = 'unrated' | 'rated' | 'discarded' | 'all'

const FILTER_HINTS: Record<Filter, string> = {
  all: 'Everything except discards',
  unrated: 'Still to triage — no rating yet',
  rated: 'Rated 1–5 stars',
  discarded: 'Soft-deleted with x — press u to undo the most recent discard',
}

export function TriageGrid() {
  const state = useAppState()
  const [filter, setFilter] = useState<Filter>('all')
  const { gridRef, columns } = useGridColumns()

  const visible = useMemo(() => {
    const all = [...state.motifs.values()].sort((a, b) => a.createdAt - b.createdAt)
    switch (filter) {
      case 'unrated':
        return all.filter((m) => !m.discarded && m.rating === 0)
      case 'rated':
        return all.filter((m) => !m.discarded && m.rating > 0)
      case 'discarded':
        return all.filter((m) => m.discarded)
      case 'all':
        return all.filter((m) => !m.discarded)
    }
  }, [state.motifs, filter])

  useKeyboardTriage(visible, columns, state.mutationTargetId === null)

  const counts = useMemo(() => {
    const all = [...state.motifs.values()]
    return {
      unrated: all.filter((m) => !m.discarded && m.rating === 0).length,
      rated: all.filter((m) => !m.discarded && m.rating > 0).length,
      discarded: all.filter((m) => m.discarded).length,
      all: all.filter((m) => !m.discarded).length,
    }
  }, [state.motifs])

  return (
    <div className="triage">
      <GenerationPanel />
      <Group gap="0.5rem" mb="0.9rem">
        {(['all', 'unrated', 'rated', 'discarded'] as Filter[]).map((f) => (
          <Tooltip key={f} label={FILTER_HINTS[f]}>
            <Button
              radius="xl"
              variant={filter === f ? 'light' : 'default'}
              color={filter === f ? 'forge' : 'gray'}
              onClick={() => setFilter(f)}
            >
              {f} ({counts[f]})
            </Button>
          </Tooltip>
        ))}
        <Text size="xs" c="dimmed" ml="auto" component="span">
          <Kbd size="xs">←</Kbd>
          <Kbd size="xs">→</Kbd>
          <Kbd size="xs">↑</Kbd>
          <Kbd size="xs">↓</Kbd> navigate · <Kbd size="xs">space</Kbd> play ·{' '}
          <Kbd size="xs">1</Kbd>–<Kbd size="xs">5</Kbd> rate · <Kbd size="xs">x</Kbd> discard ·{' '}
          <Kbd size="xs">u</Kbd> undo
        </Text>
      </Group>
      {visible.length === 0 && state.pending.length === 0 ? (
        <Text c="dimmed" ta="center" py="3rem">
          {state.motifs.size === 0
            ? 'No motifs yet — write a brief above and generate a batch.'
            : 'Nothing matches this filter.'}
        </Text>
      ) : (
        <div className="motif-grid" ref={gridRef}>
          {visible.map((m) => (
            <MotifCard key={m.id} motif={m} selected={m.id === state.selectedId} />
          ))}
          {state.pending.map((b) => (
            <div key={b.id} className="motif-card pending-card">
              <Loader size="xs" type="dots" />
              <Text size="xs" c="dimmed">
                generating {b.count} · {b.label}
              </Text>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
