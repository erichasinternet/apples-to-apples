from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import time

import modal


APP_NAME = "apples-to-apples-inference"
REPO_ROOT = Path(__file__).resolve().parent.parent
REMOTE_ROOT = Path("/workspace")
BUNDLE_NAME = os.environ.get("ATA_INFERENCE_BUNDLE", "t5gemma2-live")
INPUT_BUNDLE = REPO_ROOT / "benchmark-data" / "inference" / BUNDLE_NAME
REMOTE_BUNDLE_ROOT = REMOTE_ROOT / "benchmark-data" / "inference"
REMOTE_BUNDLE = REMOTE_BUNDLE_ROOT / BUNDLE_NAME
OUTPUT_ROOT = Path("/outputs")
CACHE_ROOT = Path("/cache")

if modal.is_local() and not INPUT_BUNDLE.is_dir():
    raise RuntimeError(
        "Prepare the live inference bundle before running Modal: "
        "`bun run training:inference:prepare`"
    )

image = (
    modal.Image.debian_slim(python_version="3.11")
    .uv_pip_install(
        "pillow>=12.3,<13",
        "peft>=0.19,<1",
        "torch>=2.13,<3",
        "transformers>=5.14,<6",
    )
    .add_local_file(
        REPO_ROOT / "training" / "infer_t5gemma2.py",
        f"{REMOTE_ROOT}/training/infer_t5gemma2.py",
        copy=True,
    )
    .add_local_dir(INPUT_BUNDLE, str(REMOTE_BUNDLE), copy=True)
)
output_volume = modal.Volume.from_name(
    "apples-to-apples-training-output", create_if_missing=True
)
cache_volume = modal.Volume.from_name(
    "apples-to-apples-huggingface-cache", create_if_missing=True
)
huggingface_secret = modal.Secret.from_name(
    "apples-to-apples-huggingface", required_keys=["HF_TOKEN"]
)
app = modal.App(
    APP_NAME,
    tags={"project": "apples-to-apples", "workload": "model-inference"},
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
    volumes={OUTPUT_ROOT: output_volume, CACHE_ROOT: cache_volume},
    env={
        "HF_HOME": f"{CACHE_ROOT}/huggingface",
        "HF_HUB_CACHE": f"{CACHE_ROOT}/huggingface/hub",
        "TOKENIZERS_PARALLELISM": "false",
    },
)
def run_inference(
    records_filename: str, checkpoint: str, bundle_name: str
) -> dict[str, object]:
    if not bundle_name or Path(bundle_name).name != bundle_name:
        raise ValueError("Invalid inference bundle name")
    remote_bundle = REMOTE_BUNDLE_ROOT / bundle_name
    output_path = Path("/tmp/predictions.jsonl")
    command = [
        "python",
        f"{REMOTE_ROOT}/training/infer_t5gemma2.py",
        "--bundle",
        str(remote_bundle),
        "--records",
        records_filename,
        "--output",
        str(output_path),
    ]
    adapters = {
        "replay": "synthetic-pilot-60-replay",
        "real-discovery": "synthetic-pilot-80-real-discovery",
        "balanced-real-discovery": "synthetic-pilot-100-real-discovery-balanced",
        "adjudicated-discovery": "synthetic-pilot-120-adjudicated-discovery",
        "expanded-adjudicated-discovery": (
            "synthetic-pilot-140-expanded-adjudicated-discovery"
        ),
    }
    if checkpoint in adapters:
        command.extend(
            [
                "--adapter",
                f"{OUTPUT_ROOT}/{adapters[checkpoint]}",
            ]
        )
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
        "recordsFile": records_filename,
        "checkpoint": adapters.get(checkpoint, "base"),
        "records": len(predictions),
        "elapsedSeconds": round(elapsed, 2),
        "gpuSeconds": round(elapsed, 2),
        "predictions": predictions,
    }


@app.local_entrypoint()
def main(
    records: str = "discovery.jsonl",
    output: str = "benchmark-data/inference/t5gemma2-live/discovery-predictions.jsonl",
    checkpoint: str = "replay",
) -> None:
    if checkpoint not in {
        "base",
        "replay",
        "real-discovery",
        "balanced-real-discovery",
        "adjudicated-discovery",
        "expanded-adjudicated-discovery",
    }:
        raise ValueError(
            "checkpoint must be base, replay, real-discovery, or "
            "balanced-real-discovery, adjudicated-discovery, or "
            "expanded-adjudicated-discovery"
        )
    result = run_inference.remote(records, checkpoint, BUNDLE_NAME)
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
