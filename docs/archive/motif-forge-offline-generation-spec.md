# Motif Forge: Offline Neural Generation — Implementation Spec

**Target repo:** https://github.com/JoeMattie/motif-forge/
**Goal:** Replace the Anthropic API dependency with fully offline, in-browser motif generation using the SkyTNT midi-model running on onnxruntime-web (WebGPU), with a zero-download symbolic fallback tier.

---

## 1. Background & Context

Motif Forge is a local-first Vite + React + TypeScript SPA for generating, triaging, mutating, and exporting melodic motifs (short MIDI phrases, ~4 bars, primarily monophonic). Persistence is IndexedDB; audio is Web Audio. The only non-local dependency today is LLM-based generation via the Anthropic API (proxied through the Vite dev server, which injects the API key — note this proxy does not exist in production builds).

This project removes that dependency entirely. Generation will work offline via two tiers:

- **Tier 1 (always available):** Deterministic symbolic generation — constrained random walk + genetic algorithm over user triage decisions. No downloads, instant, runs everywhere.
- **Tier 2 (WebGPU-gated):** Neural generation using SkyTNT's midi-model, quantized to int8, running in onnxruntime-web with the WebGPU execution provider, loaded lazily and cached in OPFS.

Tier 1 ships first and is the fallback when WebGPU is unavailable or the user declines the model download.

---

## 2. Upstream Model Reference (verified facts)

- **Model:** SkyTNT midi-model, `tv2o-medium` config. Llama-style decoder architecture. Apache 2.0.
  - HF repo: `skytnt/midi-model-tv2o-medium`
  - GitHub: https://github.com/SkyTNT/midi-model
- **Published ONNX exports exist** in the HF repo under `onnx/`: `model_base.onnx` + `model_token.onnx` (exported fp32, opset 14, with explicit past/present KV-cache inputs and outputs per layer — see `export.py` in the GitHub repo).
- **Two-model architecture:** each musical *event* is a fixed-length sequence of sub-tokens (`max_token_seq` per event). `model_base` processes the event-level sequence; `model_token` autoregressively decodes the sub-tokens of the next event conditioned on the base model's hidden state.
- **Checkpoint size:** `model.safetensors` is 468 MB (bf16) → ~230M params. The fp32 ONNX pair totals roughly ~1 GB. **Do not ship fp32.**
- **Tokenizer:** `MIDITokenizerV2` ("tv2o" = V2 optimized). Python reference implementation in the GitHub repo (`midi_tokenizer.py` or equivalent — locate it). Supports time signature, key signature, disabling control changes, and **disabling channels** (useful for constraining toward melodic content).
- **Reference inference code:** `app_onnx.py` in the GitHub repo — a Python onnxruntime + Gradio app implementing the full two-session sampling loop with KV cache, batching, continuation, temperature/top-p/top-k. This is the primary porting reference. Study it before writing any TS.
- **Smaller alternative:** the original `skytnt/midi-model` (v1.2) repo also publishes ONNX. Check its size first (Phase 0); if meaningfully smaller with acceptable quality, prefer it for the default download.

---

## 3. Phase 0 — Scoping & Verification (do this first)

Before writing app code, verify assumptions the spec is built on:

1. Clone `SkyTNT/midi-model` and read: `export.py`, `app_onnx.py`, the tokenizer implementation, and `config.json` from the HF repo. Record: exact vocab size, `max_token_seq`, number of layers/heads/hidden size, event schema (what fields an event tuple contains), and the exact ONNX input/output names for both models.
2. Download both ONNX files (medium *and* the original v1.2 model). Record actual file sizes.
3. Run the Python `app_onnx.py` locally once to establish ground-truth behavior and capture a reference: a fixed seed + prompt → token sequence → MIDI output. Save this as a golden test fixture for validating the TS port.
4. Decide medium vs. v1.2 based on size/quality. Quality bar: 4-bar monophonic melodic phrases, not full arrangements.

**Deliverable:** short findings note committed to the repo (`docs/model-notes.md`) with the recorded facts + chosen model.

## 4. Phase 1 — Offline Quantization Pipeline (Python, one-time tooling)

Create `tools/quantize/` (Python, not shipped to browser):

- Script that downloads the chosen ONNX pair from HF and runs onnxruntime post-training **dynamic int8 quantization** (`onnxruntime.quantization.quantize_dynamic`) on both models. Target: ~4x size reduction (~250 MB total for medium).
- If int8 causes audible quality degradation (validate against the golden fixture), fall back to fp16 conversion (~500 MB) via `onnxconverter-common` float16 conversion, or try quantizing `model_base` only and leaving the small `model_token` at fp16.
- Output artifacts named with content hash (e.g. `model_base.q8.<hash8>.onnx`) for cache-busting.
- Host artifacts as static files (same static host as the app, or HF hosting with CORS-friendly URLs). Document the hosting decision.

**Acceptance:** quantized models produce coherent output through the Python sampling loop; sizes recorded; artifacts uploaded.

## 5. Phase 2 — Tier 1 Symbolic Generation (TypeScript, ship independently)

Implement in `src/generation/symbolic/`:

### 5.1 Constrained random walk generator
- Inputs: key/scale, length in bars, time signature, contour template (arch | ascend | descend | zigzag | flat), rhythm archetype (straight | dotted | syncopated | sparse), seed (for reproducibility — use a seedable PRNG like mulberry32, not Math.random).
- Interval selection from a weighted table favoring steps (±1, ±2 scale degrees) over leaps; enforce leap-recovery (a leap > a third is followed by stepwise motion in the opposite direction); clamp to a configurable pitch range.
- Rhythm: quantize to 16th grid, generate from archetype templates with controlled variation density.
- Output: the app's existing internal motif representation (find it in the codebase and conform to it — do not invent a parallel format).

### 5.2 Genetic operators over triage data
- **Crossover:** splice two kept motifs at a bar or beat boundary (respect the grid).
- **Mutations:** transpose single note within scale, swap two adjacent notes, invert an interval, alter one rhythm cell, transpose whole motif, retrograde a bar.
- **Population step:** given the set of user-kept motifs (from IndexedDB), produce the next generation batch: X% crossover children, Y% mutants of keepers, Z% fresh random-walk immigrants (keep diversity). Make ratios configurable constants.
- Wire into the existing "generate batch" UX as a new generation source. Respect existing batch-size settings.

**Acceptance:** batch generation works offline with network disabled; motifs are in-key, correct length; GA batch visibly incorporates material from kept motifs; deterministic given a seed.

**As-built amendment (M6(GPT)3 incorporation, July 2026):** the population step grew into a real GA (`evolve.ts`): the ratio mix seeds a population that evolves for `EVOLVE_DEFAULTS.generations` under tournament selection against a Gaussian multi-feature fitness (`fitness.ts`, after arXiv 2409.12638), with elitism, fresh immigrants per generation, and a similarity-deduped top-n selection. The user's ratings still gate the gene pool (keepers) — the score only decides which survivors are worth triaging, and also ranks finished NEURAL batches best-first. A seeded probabilistic drum generator (`drums.ts`: per-time-sig kick/snare probability tables, melody-mapped hat density, Markov tom fills) lets the INSTANT tier honor `includeRhythm` with a lead+kit two-part motif.

## 6. Phase 3 — Tokenizer Port (TypeScript)

Implement `src/generation/neural/tokenizer.ts` — a faithful port of `MIDITokenizerV2`:

- Port encode (MIDI/app-motif → event token sequences) and decode (token sequences → notes) exactly, including special tokens (BOS/EOS/pad), the event field layout, and time signature / key signature event construction as used in `app_onnx.py`.
- The app's motifs are the source format; write adapters: `motifToEvents()` and `eventsToMotif()` (drop or ignore non-melodic channels/CC on decode; keep it monophonic-first but don't crash on polyphony).
- **Golden tests:** use the Phase 0 fixture — the TS tokenizer must produce byte-identical token sequences to the Python reference for the same input, and identical decoded notes for the same token sequence. This is non-negotiable; tokenizer drift is the most likely silent-failure mode of the whole project.

## 7. Phase 4 — Inference Engine (TypeScript, Web Worker)

Implement `src/generation/neural/engine.ts` running inside a **dedicated Web Worker** (never on the main thread):

- Dependency: `onnxruntime-web`. Create two `InferenceSession`s (base + token) with `executionProviders: ['webgpu']`. No WASM fallback for this tier (too slow at this model size) — if WebGPU session creation fails, report unavailable and let the app use Tier 1.
- Port the sampling loop from `app_onnx.py`:
  - Event-level loop over `model_base` with explicit KV cache: feed `past.{i}.key/value`, read `present.{i}.key/value`, carry forward. Preallocate/reuse buffers where possible.
  - Sub-token loop over `model_token` for each event.
  - Sampling: temperature, top-p, top-k (port exactly; add a repetition guard only if the reference has one).
  - Support `disable_channels` and disabling control changes, mirroring the reference app, to bias output toward single-line melodic content.
  - Stop conditions: EOS, max events, or reaching the requested bar length (compute from decoded event times).
- **Streaming batches:** generate candidates sequentially (or in small ONNX batches if the export's batch dim allows — verify in Phase 0) and `postMessage` each completed motif to the UI immediately so the triage queue fills progressively. Include progress events (n of N, tokens/sec).
- Support **continuation/priming**: accept an optional prompt motif (encoded as context) so keepers can seed neural variations. This is the neural analog of the GA and should share the same "variations of this keeper" UI affordance.
- Cancellation: an in-flight batch must be abortable from the UI.

## 8. Phase 5 — Model Loading, Caching, Gating (TypeScript)

- **Feature gate:** `navigator.gpu` presence + successful adapter request + successful session creation = neural tier available. Surface as app state, not a hard requirement.
- **Explicit opt-in download:** neural generation is off until the user clicks "Enable neural generation (~250 MB download)". Show download progress (streamed fetch with progress), then verify content hash.
- **Cache in OPFS** (Origin Private File System): store the ONNX bytes; on subsequent loads, read from OPFS and create sessions from the ArrayBuffer. Handle `QuotaExceededError` gracefully. Add a "remove downloaded model" control in settings.
- Service worker (if the app doesn't have one, add one) for app-shell offline capability so the whole product is airplane-mode capable; model bytes live in OPFS, not the SW cache.
- UI states to implement: unavailable (no WebGPU) / available-not-downloaded / downloading / ready / error. When unavailable, Tier 1 is presented as the generation method without apology.

## 9. Phase 6 — Integration & Cleanup

- Generation source selector in the UI: "Instant (rules + evolution)" and "Neural (on-device model)". Default: Instant.
- Remove the Anthropic API code path and the Vite proxy config (or leave behind a compile-time flag if you want to keep it for comparison during development — then remove before release).
- Ensure IndexedDB schema/migrations accommodate any new motif metadata (generation source, seed, parent motif IDs for GA/continuation lineage). Lineage metadata is worth storing — it enables "show me this motif's ancestry" later.
- Update README: offline capabilities, model download size, WebGPU requirement for the neural tier, attribution + Apache 2.0 license notice for SkyTNT midi-model, and a licensing note that training data includes large scraped MIDI corpora (Los Angeles / Monster MIDI datasets).

---

## 10. Performance Targets & Constraints

- Neural: first motif streamed within ~5 s of request start on Apple Silicon / midrange discrete GPU; UI at 60 fps throughout (all inference in the worker).
- Symbolic: batch of 100 motifs < 100 ms.
- Memory: keep peak JS-heap for inference bookkeeping modest; weights + KV live GPU-side via the WebGPU EP. Short sequences (4 bars) keep KV small — don't over-engineer.
- Mobile is explicitly out of scope for the neural tier (gate it off on coarse pointer + small viewport or just let WebGPU/download friction handle it); Tier 1 must work on mobile.

## 11. Testing

- Golden-fixture tests for tokenizer (Phase 3) — byte-exact vs. Python reference.
- Unit tests for symbolic generators (in-key invariants, leap-recovery invariant, length correctness, seed determinism).
- GA property tests: children contain material from parents; population diversity floor holds.
- One Playwright smoke test: app boots with network disabled and generates a Tier 1 batch.
- Manual listening pass comparing quantized vs. fp32 output (Python side) before accepting int8.

## 12. Risks & Open Questions (resolve in Phase 0)

1. **Exact ONNX I/O shapes/names** for the published exports — spec assumes `past.{i}.key/value` naming per `export.py`; verify.
2. **Batch dimension support** in the published export (export script shows batch_size=1 defaults; batching may require re-export via `export.py`, which is available and Apache 2.0 — acceptable if needed).
3. **int8 quality** — may need fp16 or mixed precision instead; budget for this.
4. **onnxruntime-web WebGPU op coverage** for this graph at opset 14 — if an op falls back to CPU it will be slow; check the ORT profiling output for EP assignment.
5. **Model bias toward full arrangements** — trained on multitrack song corpora; if unconstrained output quality for bare 4-bar monophonic motifs is poor, mitigate via priming context (key/time-sig events + a seed melody fragment) and channel disabling. If still poor, the fallback plan is a small custom-trained model (out of scope for this doc, but keep the engine model-agnostic: sizes, vocab, and I/O names should come from a config object, not constants).

## 13. Suggested Commit/PR Sequence

1. PR1: Phase 2 (symbolic tier) + tests — ships user value immediately, independent of everything else.
2. PR2: Phase 0 findings doc + Phase 1 quantization tooling.
3. PR3: Phase 3 tokenizer + golden tests.
4. PR4: Phase 4 engine + Phase 5 loading/gating.
5. PR5: Phase 6 integration, API removal, docs.
