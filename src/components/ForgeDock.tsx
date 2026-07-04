import { useEffect, useRef, useState } from 'react'
import { Tabs } from '@mantine/core'
import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react'
import { subscribeReveal } from '../noodle/takeStore'
import { GenerationPanel } from './GenerationPanel'
import { NoodlePanel, NoodleSummary } from './NoodlePanel'

type ForgeTab = 'generate' | 'noodle'

/**
 * One dock module for both material sources: GENERATE (batch engines) and
 * NOODLE (Joe's own input) are tabs, so only one is ever open. Clicking the
 * active tab collapses the dock to that panel's summary strip. Both panels
 * stay mounted (display-none, not Activity — their engine/store subscriptions
 * and run tracking must keep working while hidden) so briefs, knob settings,
 * run progress, and the staged take survive tab flips and view switches.
 * The dock keeps GenerationPanel's old sticky behavior against the .view
 * scroller.
 */
export function ForgeDock() {
  const [tab, setTab] = useState<ForgeTab>('generate')
  const [open, setOpen] = useState(true)

  const dockRef = useRef<HTMLElement | null>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    // The dock sits inside a display:contents keep-alive wrapper (App.tsx),
    // so walk up to the scrolling .view container rather than parentElement.
    const scroller = dockRef.current?.closest('.view')
    if (!scroller) return
    const onScroll = () => setStuck(scroller.scrollTop > 2)
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  // The N hotkey stages a pool clip — bring the NOODLE tab up, unfolded.
  useEffect(
    () =>
      subscribeReveal(() => {
        setTab('noodle')
        setOpen(true)
      }),
    [],
  )

  // Clicking the active tab toggles the fold (the old title-button gesture);
  // switching tabs always lands unfolded.
  const clickTab = (next: ForgeTab) => {
    if (next === tab) {
      setOpen((o) => !o)
    } else {
      setTab(next)
      setOpen(true)
    }
  }

  const caret = (t: ForgeTab) =>
    t === tab && open ? <CaretDownIcon size={10} /> : <CaretRightIcon size={10} />

  return (
    <section ref={dockRef} className={`module gen-dock${stuck ? ' stuck' : ''}`}>
      <Tabs
        value={tab}
        onChange={(v) => v && setTab(v as ForgeTab)}
        keepMounted
        keepMountedMode="display-none"
        unstyled
        classNames={{
          root: 'forge-tabs',
          list: 'forge-tab-list',
          tab: 'forge-tab',
          panel: 'forge-tab-panel',
        }}
      >
        <Tabs.List>
          <Tabs.Tab value="generate" onClick={() => clickTab('generate')}>
            <span>Generate</span> {caret('generate')}
          </Tabs.Tab>
          <Tabs.Tab value="noodle" onClick={() => clickTab('noodle')}>
            <span>Noodle</span> {caret('noodle')}
          </Tabs.Tab>
          {/* the take summary + live chip ride right of the tabs so the panel
              never spends a row on them and capture state survives folding */}
          {tab === 'noodle' && <NoodleSummary />}
        </Tabs.List>
        <Tabs.Panel value="generate">
          <GenerationPanel open={open && tab === 'generate'} />
        </Tabs.Panel>
        <Tabs.Panel value="noodle">
          <NoodlePanel open={open && tab === 'noodle'} />
        </Tabs.Panel>
      </Tabs>
    </section>
  )
}
