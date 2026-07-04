import { Modal } from '@mantine/core'

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
      title={
        <>
          <span className="brand">MOTIF–FORGE</span>
          <span className="brand-sub">ABOUT · MF–01</span>
        </>
      }
    >
      <div className="about">
        <section className="module about-module">
          <h3 className="about-label">What it does</h3>
          <p>
            Motif Forge is a local-first workbench for building a personal library of short
            musical ideas. It generates batches of 2–8-bar polyphonic motifs, lets you audition
            and triage them by ear at speed, evolve the keepers through mutation, organize them
            into song concepts as leitmotifs, and export the results as MIDI or WAV — ready to
            seed tools like Suno.
          </p>
        </section>

        <section className="module about-module">
          <h3 className="about-label">How it works</h3>
          <p>
            <span className="about-term">Generate.</span> Three engines: INSTANT builds motifs
            offline with seeded random walks plus a genetic algorithm that breeds your top-rated
            keepers; NEURAL samples a transformer music model running entirely on your GPU;
            CLAUDE asks Anthropic's model to compose, using your own API key. Every candidate
            passes the same validator before it reaches the pool.
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
        </section>

        <section className="module about-module">
          <h3 className="about-label">The local neural model</h3>
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
            funnels through the same validator as Claude batches.
          </p>
        </section>

        <section className="module about-module">
          <h3 className="about-label">Under the hood</h3>
          <dl className="about-tech">
            {TECH.map((t) => (
              <div key={t.name}>
                <dt>{t.name}</dt>
                <dd>{t.role}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Modal>
  )
}
