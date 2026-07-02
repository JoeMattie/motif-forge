import { useMemo, useState } from 'react'
import { Button, Group, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { useAppDispatch, useAppState } from '../store/AppContext'
import { newId } from '../core/ids'
import { MotifCard } from './MotifCard'

export function LibraryView() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const [minRating, setMinRating] = useState(3)
  const [newConcept, setNewConcept] = useState('')

  const kept = useMemo(
    () =>
      [...state.motifs.values()]
        .filter((m) => !m.discarded && m.rating >= minRating)
        .sort((a, b) => b.rating - a.rating || a.createdAt - b.createdAt),
    [state.motifs, minRating],
  )

  const createConcept = () => {
    const name = newConcept.trim()
    if (!name) return
    dispatch({
      type: 'CONCEPT_CREATED',
      concept: { id: newId(), name, createdAt: Date.now() },
    })
    setNewConcept('')
  }

  return (
    <div className="library">
      <Group gap="0.5rem" mb="0.9rem">
        <Tooltip label="Only show motifs rated at least this highly">
          <label className="transport-control">
            min rating
            <Select
              w={110}
              value={String(minRating)}
              onChange={(v) => v && setMinRating(Number(v))}
              data={[1, 2, 3, 4, 5].map((r) => ({ value: String(r), label: '★'.repeat(r) }))}
            />
          </label>
        </Tooltip>
        <span className="spacer" />
        <TextInput
          placeholder="new concept name"
          value={newConcept}
          onChange={(e) => setNewConcept(e.currentTarget.value)}
        />
        <Button onClick={createConcept} disabled={!newConcept.trim()}>
          + concept
        </Button>
      </Group>
      {kept.length === 0 ? (
        <Text c="dimmed" ta="center" py="3rem">
          No motifs rated {'★'.repeat(minRating)} or higher yet.
        </Text>
      ) : (
        <div className="motif-grid">
          {kept.map((m) => (
            <Stack key={m.id} gap={6}>
              <MotifCard motif={m} selected={m.id === state.selectedId} showConcept />
              <Tooltip label="Tag this motif to a song concept">
                <Select
                  size="xs"
                  value={m.conceptId ?? ''}
                  onChange={(v) =>
                    dispatch({
                      type: 'MOTIF_ASSIGNED_CONCEPT',
                      id: m.id,
                      conceptId: v || null,
                    })
                  }
                  data={[
                    { value: '', label: 'no concept' },
                    ...[...state.concepts.values()].map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </Tooltip>
            </Stack>
          ))}
        </div>
      )}
    </div>
  )
}
