import { Modal, Tabs } from '@mantine/core'

const TECH: { name: string; role: string }[] = [
  { name: 'React 19 + TS + Vite', role: 'strict-mode UI shell; everything runs in the browser' },
  { name: 'Mantine + Phosphor', role: 'component library, skinned as hardware keys, knobs and LCDs' },
  { name: 'Tone.js + smplr', role: 'synth voices and sampled instruments over the Web Audio API' },
  { name: 'Anthropic API', role: 'claude-sonnet-4-6 composes motifs as JSON on the CLAUDE engine, on your own API key (KEY in the header, stored only in this browser)' },
  { name: 'onnxruntime-web', role: 'WebGPU inference for the on-device NEURAL engine' },
  { name: 'MIDI + WAV', role: 'hand-rolled SMF format-0 writer and WAV encoder, no libraries' },
  { name: 'IndexedDB + OPFS', role: 'local-first persistence for motifs and cached model weights' },
]

/** ABOUT panel — what the forge does, how it works, and what it's built from. */
export function AboutModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size={880}
      title={
        <>
          <span className="brand">MOTIF–FORGE</span>
          <span className="brand-sub">ABOUT · MF–01</span>
        </>
      }
    >
      <Tabs className="about-tabs" orientation="vertical" defaultValue="what">
        <Tabs.List>
          <Tabs.Tab value="what">What it does</Tabs.Tab>
          <Tabs.Tab value="how">How it works</Tabs.Tab>
          <Tabs.Tab value="instant">Instant engine</Tabs.Tab>
          <Tabs.Tab value="genetic">Genetic engine</Tabs.Tab>
          <Tabs.Tab value="neural">Neural model</Tabs.Tab>
          <Tabs.Tab value="tech">Under the hood</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="what" className="about-panel">
          <p>
            Motif Forge is a local-first workbench for building a personal library of short
            musical ideas. It generates batches of 2–8-bar polyphonic motifs, lets you audition
            and triage them by ear at speed, evolve the keepers through mutation, organize them
            into song concepts as leitmotifs, and export the results as MIDI or WAV — ready to
            seed tools like Suno.
          </p>
        </Tabs.Panel>

        <Tabs.Panel value="how" className="about-panel">
          <p>
            <span className="about-term">Generate.</span> Four engines: INSTANT evolves motifs
            offline — random walks and your top-rated keepers bred against a musical fitness,
            with an optional seeded drum groove; GENETIC evolves rhythm genomes against a
            groove fitness function and pitches them in-key; NEURAL samples a transformer music
            model running entirely on your GPU; CLAUDE asks Anthropic's model to compose, using
            your own API key. Set the brief on a
            circle-of-fifths key dial with mode, tempo and bars beside it — or arm the dice to
            re-roll any of them per generation. Every candidate passes the same validator before
            it reaches the pool.
          </p>
          <p>
            <span className="about-term">Triage.</span> Keyboard-first: arrows move, Space
            plays, 1–5 rates, X discards. Work the whole pool in the grid, or one motif at a
            time in the Focus deck with auto-advance.
          </p>
          <p>
            <span className="about-term">Mutate.</span> Every motif keeps its lineage, so a root
            and its descendants show as one family card with a fold-out tray. Deterministic
            transforms (inversion, retrograde, transposition, mode swap…) and LLM rewrites make
            variants; the Mutation Bay remixes one motif part by part.
          </p>
          <p>
            <span className="about-term">Ship.</span> Tag families to song concepts, then export
            standard MIDI files or offline-rendered WAV. Everything persists in your browser —
            no server, no account.
          </p>
        </Tabs.Panel>

        <Tabs.Panel value="instant" className="about-panel">
          <p>
            INSTANT starts from constrained random walks: pitch moves by scale degrees only —
            always in-key — pulled toward a contour template (arch, ascend, descend, zigzag,
            flat), leaps resolving stepwise, rhythm built from per-beat archetype cells on a
            16th grid.
          </p>
          <p>
            <span className="about-term">Bred, not just rolled.</span> Each press evolves a
            whole population — fresh walks plus crossovers and mutants of your ★3+ keepers —
            through tournament selection against a musical fitness: a sum of Gaussian targets
            over features like stepwise motion, strong-beat coverage, repetition and tonal
            anchoring (after the M6(GPT)3 paper). Only the fittest mutually-distinct survivors
            reach the grid, and the same score re-ranks finished NEURAL batches best-first.
            Your ratings remain the real fitness — they decide what breeds next.
          </p>
          <p>
            <span className="about-term">Rhythm.</span> The RHYTHM toggle lays a seeded
            probabilistic drum groove under the line: per-time-signature kick and snare
            probability tables, hat density matched to the melody's busyness, open-hat accents
            at bar ends, a small tom fill to close. Like every offline engine, one stored seed
            reproduces the whole batch.
          </p>
        </Tabs.Panel>

        <Tabs.Panel value="genetic" className="about-panel">
          <p>
            GENETIC is a faithful port of jporpha's <span className="about-term">ga-riffs</span>:
            each riff is one evolutionary run over a population of binary rhythm genomes — one
            bit per 16th-note step. Fitness rewards hitting a target density, landing on the
            groove's accent grid, an appetite for syncopation, and varied note spacing, while
            penalizing long runs and dead bars. Tournament selection, elitism, single-point
            crossover and bit-flip mutation refine 120 candidates over 200 generations, with a
            quarter of the starting pool seeded from Euclidean patterns.
          </p>
          <p>
            <span className="about-term">The GA decides when, the assigner decides what.</span>{' '}
            The winning rhythm is then pitched entirely in-key from a root-and-fifth-heavy
            palette, accented steps louder. GROOVE presets (techno, organic's triplet feel,
            tribal) set the fitness weights; SURPRISE synthesizes a brand-new preset per riff.
            Unlike INSTANT's evolution, it never reads your library — and like every offline
            engine, each riff stores its seed, so it can be reproduced exactly.
          </p>
        </Tabs.Panel>

        <Tabs.Panel value="neural" className="about-panel">
          <p>
            The NEURAL engine runs SkyTNT's <span className="about-term">midi-model</span>{' '}
            (tv2o-medium): two Llama-style transformer decoders working as a pair — a 12-layer
            model predicts the next musical event, and a 3-layer model spells each event out as
            up to 8 sub-tokens (timing on a 16th-note grid, pitch, velocity, duration…) over a
            3406-token vocabulary.
          </p>
          <p>
            <span className="about-term">How it was built.</span> The published fp32 ONNX
            exports (~890&nbsp;MB) are quantized to int8 (~226&nbsp;MB) by this repo's own
            Python tooling, accepted by a listening test, and pinned by content hash. The
            tokenizer is a line-for-line TypeScript port of the Python reference, locked to
            byte-identical output by golden-fixture tests.
          </p>
          <p>
            <span className="about-term">How it runs.</span> One opt-in, sha256-verified
            download cached in the browser's private file system (OPFS). Inference runs on your
            GPU via onnxruntime-web (WebGPU) in a dedicated worker — nothing leaves your
            machine. Sampling is seeded, so every motif it makes is reproducible, and its output
            funnels through the same validator as Claude batches. When a batch finishes, it is
            re-ranked best-first in the grid by the same musical fitness that drives INSTANT.
          </p>
        </Tabs.Panel>

        <Tabs.Panel value="tech" className="about-panel">
          <dl className="about-tech">
            {TECH.map((t) => (
              <div key={t.name}>
                <dt>{t.name}</dt>
                <dd>{t.role}</dd>
              </div>
            ))}
          </dl>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  )
}
