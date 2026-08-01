from __future__ import annotations

import json
from pathlib import Path
import subprocess
import time

import modal


APP_NAME = "apples-to-apples-unit-price-review"
REPO_ROOT = Path(__file__).resolve().parent.parent
REMOTE_ROOT = Path("/workspace")
CACHE_ROOT = Path("/cache")
AUDIT_FILE = REPO_ROOT / "artifacts" / "audits" / "unit-price-false-positives.json"

if modal.is_local() and not AUDIT_FILE.is_file():
    raise RuntimeError("Run `bun run audit:false-positives` before model review")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .uv_pip_install(
        "accelerate>=1.14,<2",
        "torch>=2.8,<3",
        "transformers>=4.57,<6",
    )
    .add_local_file(
        REPO_ROOT / "training" / "review_unit_prices_hf.py",
        f"{REMOTE_ROOT}/training/review_unit_prices_hf.py",
        copy=True,
    )
    .add_local_file(
        AUDIT_FILE,
        f"{REMOTE_ROOT}/artifacts/audits/unit-price-false-positives.json",
        copy=True,
    )
)
cache_volume = modal.Volume.from_name(
    "apples-to-apples-huggingface-cache", create_if_missing=True
)
huggingface_secret = modal.Secret.from_name(
    "apples-to-apples-huggingface", required_keys=["HF_TOKEN"]
)
app = modal.App(
    APP_NAME,
    tags={"project": "apples-to-apples", "workload": "unit-price-review"},
)


@app.function(
    image=image,
    gpu="A10",
    cpu=4,
    memory=16384,
    timeout=60 * 60,
    retries=0,
    single_use_containers=True,
    secrets=[huggingface_secret],
    volumes={CACHE_ROOT: cache_volume},
    env={
        "HF_HOME": f"{CACHE_ROOT}/huggingface",
        "HF_HUB_CACHE": f"{CACHE_ROOT}/huggingface/hub",
        "TOKENIZERS_PARALLELISM": "false",
    },
)
def run_review(max_records: int | None, batch_size: int) -> dict[str, object]:
    output_path = Path("/tmp/unit-price-semantic-reviews.jsonl")
    command = [
        "python",
        f"{REMOTE_ROOT}/training/review_unit_prices_hf.py",
        "--audit",
        f"{REMOTE_ROOT}/artifacts/audits/unit-price-false-positives.json",
        "--output",
        str(output_path),
        "--batch-size",
        str(batch_size),
    ]
    if max_records is not None:
        command.extend(["--max-records", str(max_records)])
    started = time.monotonic()
    subprocess.run(command, cwd=REMOTE_ROOT, check=True)
    elapsed = time.monotonic() - started
    cache_volume.commit()
    return {
        "modelId": "Qwen/Qwen3-4B-Instruct-2507",
        "reviewPromptVersion": 1,
        "elapsedSeconds": round(elapsed, 2),
        "gpuSeconds": round(elapsed, 2),
        "reviews": output_path.read_text(encoding="utf-8"),
    }


@app.local_entrypoint()
def main(
    output: str = "artifacts/audits/unit-price-semantic-reviews.jsonl",
    max_records: int | None = None,
    batch_size: int = 32,
) -> None:
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")
    result = run_review.remote(max_records, batch_size)
    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(str(result.pop("reviews")), encoding="utf-8")
    result["output"] = str(output_path)
    print(json.dumps(result, indent=2))
