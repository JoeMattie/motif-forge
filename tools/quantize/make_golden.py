"""Phase 0 golden fixture: tokenizer reference vectors for the TS port.

Produces neural-golden.json with:
  - encode: a hand-built MIDI score (MIDI.py format) -> token sequences
  - decode: those token sequences -> detokenized score
  - vocab facts (ids, ranges) so TS tests can assert the layout

Run from the midi-model checkout so midi_tokenizer/MIDI are importable.
"""
import json
import sys

sys.path.insert(0, "midi-model")
from midi_tokenizer import MIDITokenizerV2  # noqa: E402

TPB = 480  # ticks per beat of the input score


def beats(b):
    return int(b * TPB)


# A 4-bar polyphonic score exercising every event type the app cares about:
# tempo, time signature, key signature, patch changes, two melodic channels,
# a drum channel (9), and a control change.
score = [
    TPB,
    [  # track 0: meta
        ["set_tempo", 0, 500000],           # 120 BPM
        ["time_signature", 0, 4, 2],        # 4/4 (dd=2 -> denominator 4)
        ["key_signature", 0, -1, 0],        # one flat (F major / D dorian pitch set)
    ],
    [  # track 1: lead on channel 0
        ["patch_change", 0, 0, 0],          # acoustic grand
        ["note", beats(0.0), beats(1.0), 0, 62, 96],
        ["note", beats(1.0), beats(0.5), 0, 65, 88],
        ["note", beats(1.5), beats(0.5), 0, 67, 90],
        ["note", beats(2.0), beats(2.0), 0, 69, 100],
        ["note", beats(4.0), beats(1.0), 0, 67, 92],
        ["note", beats(5.0), beats(0.25), 0, 65, 84],
        ["note", beats(5.25), beats(0.75), 0, 64, 86],
        ["note", beats(6.0), beats(2.0), 0, 62, 98],
        ["control_change", beats(6.0), 0, 64, 100],  # sustain pedal
    ],
    [  # track 2: pad dyads on channel 1 (polyphony)
        ["patch_change", 0, 1, 48],         # strings
        ["note", beats(0.0), beats(4.0), 1, 50, 70],
        ["note", beats(0.0), beats(4.0), 1, 57, 70],
        ["note", beats(4.0), beats(4.0), 1, 48, 72],
        ["note", beats(4.0), beats(4.0), 1, 55, 72],
    ],
    [  # track 3: drums on channel 9
        ["note", beats(0.0), beats(0.25), 9, 36, 110],
        ["note", beats(1.0), beats(0.25), 9, 38, 95],
        ["note", beats(2.0), beats(0.25), 9, 36, 108],
        ["note", beats(3.0), beats(0.25), 9, 38, 96],
        ["note", beats(0.5), beats(0.125), 9, 42, 70],
        ["note", beats(1.5), beats(0.125), 9, 42, 68],
    ],
]

tok = MIDITokenizerV2()
tok.set_optimise_midi(True)

tokens = tok.tokenize(score)                 # includes BOS/EOS rows
events = [tok.tokens2event(t) for t in tokens if t[0] in tok.id_events]
decoded = tok.detokenize(tokens)

fixture = {
    "model": "skytnt/midi-model-tv2o-medium",
    "tokenizer": tok.to_dict(),
    "parameter_id_starts": {p: ids[0] for p, ids in tok.parameter_ids.items()},
    "encode": {
        "inputScore": score,
        "tokens": tokens,
    },
    "decode": {
        "events": events,
        "outputScore": decoded,
    },
}

with open("neural-golden.json", "w") as f:
    json.dump(fixture, f, indent=1)
print(f"events: {len(tokens)} rows (incl. BOS/EOS); vocab {tok.vocab_size}")
