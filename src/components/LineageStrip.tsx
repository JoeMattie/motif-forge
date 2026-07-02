import { Anchor, Group, Stack, Text, Tooltip } from '@mantine/core'
import type { Motif } from '../types'
import { parentIdOf } from '../types'
import { useAppDispatch, useAppState } from '../store/AppContext'

function sourceLabel(m: Motif): string {
  switch (m.source.kind) {
    case 'seed':
      return 'seed'
    case 'generated':
      return 'generated'
    case 'transform':
      return m.source.transform
    case 'llm-mutation':
      return `LLM: "${m.source.brief.slice(0, 60)}${m.source.brief.length > 60 ? '…' : ''}"`
  }
}

/** Ancestor chain (root → motif) plus direct children of the motif. */
export function LineageStrip({ motif }: { motif: Motif }) {
  const { motifs } = useAppState()
  const dispatch = useAppDispatch()

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

  const children = [...motifs.values()]
    .filter((m) => parentIdOf(m) === motif.id)
    .sort((a, b) => a.createdAt - b.createdAt)

  return (
    <Stack gap={4} className="lineage">
      <div className="lineage-chain">
        {chain.map((m, i) => (
          <span key={m.id}>
            {i > 0 && <span className="lineage-arrow"> → </span>}
            <Tooltip label={sourceLabel(m)}>
              <Anchor
                component="button"
                size="sm"
                c={m.id === motif.id ? 'forge.5' : 'blue.3'}
                underline={m.id === motif.id ? 'never' : 'hover'}
                onClick={() => dispatch({ type: 'SET_MUTATION_TARGET', id: m.id })}
              >
                {m.name}
              </Anchor>
            </Tooltip>
          </span>
        ))}
      </div>
      {children.length > 0 && (
        <Group gap="0.35rem">
          <Text size="xs" c="dimmed" component="span">
            {children.length} descendant{children.length > 1 ? 's' : ''}:
          </Text>
          {children.map((c) => (
            <Tooltip key={c.id} label={c.name}>
              <Anchor
                component="button"
                size="sm"
                c="blue.3"
                underline="hover"
                onClick={() => dispatch({ type: 'SET_MUTATION_TARGET', id: c.id })}
              >
                {sourceLabel(c)}
              </Anchor>
            </Tooltip>
          ))}
        </Group>
      )}
    </Stack>
  )
}
