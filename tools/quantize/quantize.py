"""Phase 1 offline quantization pipeline (one-time tooling, never shipped).

Downloads the SkyTNT midi-model tv2o-medium ONNX pair from HuggingFace and
produces int8 dynamically-quantized copies named with a content hash for
cache-busting, e.g. model_base.q8.1a2b3c4d.onnx.

Usage (from tools/quantize/):
    uv venv venv && uv pip install --python venv/bin/python -r requirements.txt
    venv/bin/python quantize.py [--out DIR] [--work DIR] [--fp16]

--fp16 additionally emits fp16 conversions (the fallback if int8 quality is
unacceptable in the listening pass; see the spec, Phase 1).
"""
import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

HF_BASE = "https://huggingface.co/skytnt/midi-model-tv2o-medium/resolve/main"
FILES = ["onnx/model_base.onnx", "onnx/model_token.onnx"]


def download(url: str, dest: Path) -> None:
    if dest.exists():
        print(f"cached: {dest}")
        return
    print(f"downloading {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.rename(dest)


def hash8(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()[:8]


def quantize_int8(src: Path, out_dir: Path, stem: str) -> Path:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    tmp = out_dir / f"{stem}.q8.onnx"
    print(f"int8-quantizing {src.name} …")
    quantize_dynamic(str(src), str(tmp), weight_type=QuantType.QInt8,
                     extra_options={"MatMulConstBOnly": True})
    final = out_dir / f"{stem}.q8.{hash8(tmp)}.onnx"
    tmp.rename(final)
    return final


def convert_fp16(src: Path, out_dir: Path, stem: str) -> Path:
    import onnx
    from onnxconverter_common import float16

    print(f"fp16-converting {src.name} …")
    model = onnx.load(str(src))
    model16 = float16.convert_float_to_float16(model, keep_io_types=True)
    tmp = out_dir / f"{stem}.f16.onnx"
    onnx.save(model16, str(tmp), save_as_external_data=False)
    final = out_dir / f"{stem}.f16.{hash8(tmp)}.onnx"
    tmp.rename(final)
    return final


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="dist", help="output dir for quantized artifacts")
    ap.add_argument("--work", default="work", help="download/cache dir for fp32 sources")
    ap.add_argument("--fp16", action="store_true", help="also emit fp16 conversions")
    args = ap.parse_args()

    here = Path(__file__).parent
    work = (here / args.work).resolve()
    out = (here / args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)

    manifest = {"source": HF_BASE, "artifacts": {}}
    for rel in FILES:
        src = work / Path(rel).name
        download(f"{HF_BASE}/{rel}", src)
        stem = src.stem
        q8 = quantize_int8(src, out, stem)
        entry = {
            "fp32_bytes": src.stat().st_size,
            "int8": {"file": q8.name, "bytes": q8.stat().st_size, "sha256_8": q8.name.split(".")[-2]},
        }
        if args.fp16:
            f16 = convert_fp16(src, out, stem)
            entry["fp16"] = {"file": f16.name, "bytes": f16.stat().st_size,
                             "sha256_8": f16.name.split(".")[-2]}
        manifest["artifacts"][stem] = entry
        print(f"{stem}: fp32 {src.stat().st_size >> 20} MB -> int8 {q8.stat().st_size >> 20} MB")

    with open(out / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"manifest written to {out / 'manifest.json'}")


if __name__ == "__main__":
    main()
