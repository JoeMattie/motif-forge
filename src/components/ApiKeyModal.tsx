import { Button, Group, Modal, PasswordInput } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useAnthropicKey } from '../uiPrefs'

/**
 * KEY panel — the user's own Anthropic API key for the CLAUDE engine and LLM
 * mutations. Stored only in this browser's localStorage; sent only to
 * api.anthropic.com. Without one, dev builds fall back to the Vite proxy.
 */
export function ApiKeyModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [storedKey, setStoredKey, clearStoredKey] = useAnthropicKey()
  const [draft, setDraft] = useState(storedKey)

  useEffect(() => {
    if (opened) setDraft(storedKey)
  }, [opened, storedKey])

  const save = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    setStoredKey(trimmed)
    onClose()
  }
  const clear = () => {
    clearStoredKey()
    setDraft('')
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size={560}
      title={
        <>
          <span className="brand">MOTIF–FORGE</span>
          <span className="brand-sub">API KEY · MF–01</span>
        </>
      }
    >
      <div className="about">
        <section className="module about-module">
          <h3 className="about-label">Your Anthropic API key</h3>
          <p>
            The CLAUDE engine and LLM mutations run on your own key. It is stored only in this
            browser (localStorage) and sent only to api.anthropic.com — never to any other
            server. Create one under API keys at console.anthropic.com.
          </p>
          <PasswordInput
            placeholder="sk-ant-..."
            aria-label="Anthropic API key"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
          <Group mt="sm" gap="xs">
            <Button className="accent" disabled={!draft.trim()} onClick={save}>
              Save key
            </Button>
            <Button className="danger-text" disabled={!storedKey} onClick={clear}>
              Clear key
            </Button>
          </Group>
        </section>
      </div>
    </Modal>
  )
}
