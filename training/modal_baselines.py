from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import time

import modal


APP_NAME = "apples-to-apples-baselines"
REPO_ROOT = Path(__file__).resolve().parent.parent
REMOTE_ROOT = Path("/workspace")
OUTPUT_ROOT = Path("/outputs")
CACHE_ROOT = Path("/cache")
DATASET = REPO_ROOT / "benchmark-data" / "training" / "t5gemma2-adjudicated-discovery"
BUNDLE_NAME = os.environ.get(
    "ATA_INFERENCE_BUNDLE", "t5gemma2-selection-instacart"
)
INPUT_BUNDLE = REPO_ROOT / "benchmark-data" / "inference" / BUNDLE_NAME
REMOTE_BUNDLE = REMOTE_ROOT / "benchmark-data" / "inference" / BUNDLE_NAME

if modal.is_local() and not DATASET.is_dir():
    raise RuntimeError(
        "Prepare the adjudicated dataset before running baselines: "
        "`bun run training:adjudicated:prepare`"
    )

dependencies = [
    "accelerate>=1.14,<2",
    "datasets>=5,<6",
    "numpy>=2,<3",
    "peft>=0.19,<1",
    "torch>=2.13,<3",
    "transformers>=5.14,<6",
]
image = (
    modal.Image.debian_slim(python_version="3.11")
    .uv_pip_install(*dependencies)
    .add_local_file(
        REPO_ROOT / "training" / "train_t5gemma2.py",
        f"{REMOTE_ROOT}/training/train_t5gemma2.py",
        copy=True,
    )
    .add_local_file(
        REPO_ROOT / "training" / "train_flan_t5.py",
        f"{REMOTE_ROOT}/training/train_flan_t5.py",
        copy=True,
    )
    .add_local_file(
        REPO_ROOT / "training" / "infer_t5gemma2.py",
        f"{REMOTE_ROOT}/training/infer_t5gemma2.py",
        copy=True,
    )
    .add_local_file(
        REPO_ROOT / "training" / "infer_flan_t5.py",
        f"{REMOTE_ROOT}/training/infer_flan_t5.py",
        copy=True,
    )
    .add_local_file(
        REPO_ROOT / "training" / "flan-t5-base" / "discovery-baseline.json",
        f"{REMOTE_ROOT}/training/flan-t5-base/discovery-baseline.json",
        copy=True,
    )
    .add_local_dir(
        DATASET,
        f"{REMOTE_ROOT}/benchmark-data/training/t5gemma2-adjudicated-discovery",
        copy=True,
    )
)
if INPUT_BUNDLE.is_dir():
    image = image.add_local_dir(INPUT_BUNDLE, str(REMOTE_BUNDLE), copy=True)

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
    tags={"project": "apples-to-apples", "workload": "model-baseline"},
)


def runtime_options(gpu: str, timeout: int):
    return app.function(
        image=image,
        gpu=gpu,
        cpu=4,
        memory=16384,
        timeout=timeout,
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


@runtime_options("A10", 30 * 60)
def train_flan_pilot() -> dict[str, object]:
    output_name = "flan-t5-base-discovery-pilot-20"
    command = [
        "python",
        f"{REMOTE_ROOT}/training/train_flan_t5.py",
        "--config",
        f"{REMOTE_ROOT}/training/flan-t5-base/discovery-baseline.json",
        "--output-directory",
        f"{OUTPUT_ROOT}/{output_name}",
        "--max-train-records",
        "320",
        "--max-validation-records",
        "32",
        "--max-steps",
        "20",
        "--real-discovery-share",
        "0.5",
    ]
    started = time.monotonic()
    subprocess.run(command, cwd=REMOTE_ROOT, check=True)
    elapsed = time.monotonic() - started
    output_volume.commit()
    cache_volume.commit()
    summary_path = OUTPUT_ROOT / output_name / "evaluation-summary.json"
    return {
        "modelId": "google/flan-t5-base",
        "outputName": output_name,
        "elapsedSeconds": round(elapsed, 2),
        "gpuSeconds": round(elapsed, 2),
        "gpu": "A10",
        "evaluation": json.loads(summary_path.read_text(encoding="utf-8")),
    }


@runtime_options("T4", 20 * 60)
def infer_flan(
    records_filename: str, bundle_name: str
) -> dict[str, object]:
    if not bundle_name or Path(bundle_name).name != bundle_name:
        raise ValueError("Invalid inference bundle name")
    remote_bundle = REMOTE_ROOT / "benchmark-data" / "inference" / bundle_name
    output_path = Path("/tmp/flan-predictions.jsonl")
    command = [
        "python",
        f"{REMOTE_ROOT}/training/infer_flan_t5.py",
        "--bundle",
        str(remote_bundle),
        "--records",
        records_filename,
        "--adapter",
        f"{OUTPUT_ROOT}/flan-t5-base-discovery-pilot-20",
        "--output",
        str(output_path),
    ]
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
        "modelId": "google/flan-t5-base",
        "checkpoint": "flan-t5-base-discovery-pilot-20",
        "records": len(predictions),
        "elapsedSeconds": round(elapsed, 2),
        "gpuSeconds": round(elapsed, 2),
        "gpu": "T4",
        "predictions": predictions,
    }


@app.local_entrypoint()
def main(
    mode: str = "train-flan",
    records: str = "discovery.jsonl",
    output: str = (
        "benchmark-data/inference/t5gemma2-selection-instacart/"
        "discovery-predictions-flan-t5-base.jsonl"
    ),
) -> None:
    if mode == "train-flan":
        result = train_flan_pilot.remote()
    elif mode == "infer-flan":
        result = infer_flan.remote(records, BUNDLE_NAME)
        output_path = Path(output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            "".join(
                json.dumps(prediction) + "\n"
                for prediction in result["predictions"]
            ),
            encoding="utf-8",
        )
        result = {key: value for key, value in result.items() if key != "predictions"}
        result["output"] = str(output_path)
    else:
        raise ValueError("mode must be train-flan or infer-flan")
    print(json.dumps(result, indent=2))
