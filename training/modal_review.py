from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import time

import modal


APP_NAME = "apples-to-apples-independent-review"
REPO_ROOT = Path(__file__).resolve().parent.parent
REMOTE_ROOT = Path("/workspace")
BUNDLE_NAME = os.environ.get("ATA_REVIEW_BUNDLE", "t5gemma2-live")
INPUT_BUNDLE = REPO_ROOT / "benchmark-data" / "inference" / BUNDLE_NAME
REMOTE_BUNDLE_ROOT = REMOTE_ROOT / "benchmark-data" / "inference"
CACHE_ROOT = Path("/cache")

if modal.is_local() and not INPUT_BUNDLE.is_dir():
    raise RuntimeError(f"Inference bundle does not exist: {INPUT_BUNDLE}")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .uv_pip_install(
        "accelerate>=1.14,<2",
        "pillow>=12.3,<13",
        "torch>=2.13,<3",
        "torchvision>=0.28,<1",
        "transformers>=5.14,<6",
    )
    .add_local_file(
        REPO_ROOT / "training" / "infer_qwen3vl.py",
        f"{REMOTE_ROOT}/training/infer_qwen3vl.py",
        copy=True,
    )
    .add_local_dir(
        INPUT_BUNDLE,
        str(REMOTE_BUNDLE_ROOT / BUNDLE_NAME),
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
    tags={"project": "apples-to-apples", "workload": "independent-review"},
)


@app.function(
    image=image,
    gpu="T4",
    cpu=4,
    memory=16384,
    timeout=20 * 60,
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
def run_review(
    records_filename: str, bundle_name: str, max_records: int | None
) -> dict[str, object]:
    if not bundle_name or Path(bundle_name).name != bundle_name:
        raise ValueError("Invalid review bundle name")
    remote_bundle = REMOTE_BUNDLE_ROOT / bundle_name
    output_path = Path("/tmp/predictions.jsonl")
    command = [
        "python",
        f"{REMOTE_ROOT}/training/infer_qwen3vl.py",
        "--bundle",
        str(remote_bundle),
        "--records",
        records_filename,
        "--output",
        str(output_path),
    ]
    if max_records is not None:
        command.extend(["--max-records", str(max_records)])
    started = time.monotonic()
    subprocess.run(command, cwd=REMOTE_ROOT, check=True)
    elapsed = time.monotonic() - started
    predictions = [
        json.loads(line)
        for line in output_path.read_text(encoding="utf-8").splitlines()
        if line
    ]
    cache_volume.commit()
    return {
        "modelId": "Qwen/Qwen3-VL-2B-Instruct",
        "reviewPromptVersion": 2,
        "records": len(predictions),
        "elapsedSeconds": round(elapsed, 2),
        "gpuSeconds": round(elapsed, 2),
        "predictions": predictions,
    }


@app.local_entrypoint()
def main(
    records: str = "discovery.jsonl",
    output: str = "benchmark-data/inference/t5gemma2-live/qwen-review.jsonl",
    max_records: int | None = None,
) -> None:
    result = run_review.remote(records, BUNDLE_NAME, max_records)
    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        "".join(
            json.dumps(prediction) + "\n"
            for prediction in result["predictions"]
        ),
        encoding="utf-8",
    )
    summary = {key: value for key, value in result.items() if key != "predictions"}
    summary["output"] = str(output_path)
    print(json.dumps(summary, indent=2))
