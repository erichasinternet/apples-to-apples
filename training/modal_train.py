from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import time

import modal


APP_NAME = "apples-to-apples-training"
REPO_ROOT = Path(__file__).resolve().parent.parent
REMOTE_ROOT = Path("/workspace")
OUTPUT_ROOT = Path("/outputs")
CACHE_ROOT = Path("/cache")
SYNTHETIC_DATASET = (
    REPO_ROOT / "benchmark-data" / "training" / "t5gemma2-synthetic"
)

if modal.is_local() and not SYNTHETIC_DATASET.is_dir():
    raise RuntimeError(
        "Generate the synthetic dataset before running Modal: "
        "`bun run training:synthetic:generate`"
    )

dependencies = [
    "accelerate>=1.14,<2",
    "datasets>=5,<6",
    "numpy>=2,<3",
    "peft>=0.19,<1",
    "pillow>=12.3,<13",
    "torch>=2.13,<3",
    "transformers>=5.14,<6",
]
image = (
    modal.Image.debian_slim(python_version="3.11")
    .uv_pip_install(*dependencies)
    .add_local_dir(REPO_ROOT / "training", f"{REMOTE_ROOT}/training", copy=True)
    .add_local_dir(
        SYNTHETIC_DATASET,
        f"{REMOTE_ROOT}/benchmark-data/training/t5gemma2-synthetic",
        copy=True,
    )
)
output_volume = modal.Volume.from_name(
    "apples-to-apples-training-output", create_if_missing=True
)
cache_volume = modal.Volume.from_name(
    "apples-to-apples-huggingface-cache", create_if_missing=True
)
diagnose_only = os.environ.get("ATA_MODAL_DIAGNOSE_ONLY") == "1"
huggingface_secret = (
    None
    if diagnose_only
    else modal.Secret.from_name(
        "apples-to-apples-huggingface", required_keys=["HF_TOKEN"]
    )
)
app = modal.App(
    APP_NAME,
    tags={"project": "apples-to-apples", "workload": "model-training"},
)


@app.function(
    image=image,
    gpu="T4",
    cpu=2,
    memory=8192,
    timeout=300,
    retries=0,
    single_use_containers=True,
)
def diagnose() -> dict[str, object]:
    import torch

    started = time.monotonic()
    subprocess.run(
        [
            "python",
            f"{REMOTE_ROOT}/training/train_t5gemma2.py",
            "--config",
            f"{REMOTE_ROOT}/training/t5gemma2-270m/synthetic-pretrain.json",
            "--validate-only",
        ],
        cwd=REMOTE_ROOT,
        check=True,
    )
    device = torch.cuda.get_device_properties(0)
    return {
        "valid": True,
        "gpu": device.name,
        "gpuMemoryGiB": round(device.total_memory / 1024**3, 2),
        "torch": str(torch.__version__),
        "cuda": str(torch.version.cuda),
        "elapsedSeconds": round(time.monotonic() - started, 2),
    }


def training_function(*, timeout: int):
    return app.function(
        image=image,
        gpu="A10",
        cpu=4,
        memory=16384,
        timeout=timeout,
        retries=0,
        single_use_containers=True,
        secrets=[] if huggingface_secret is None else [huggingface_secret],
        volumes={
            OUTPUT_ROOT: output_volume,
            CACHE_ROOT: cache_volume,
        },
        env={
            "HF_HOME": f"{CACHE_ROOT}/huggingface",
            "HF_HUB_CACHE": f"{CACHE_ROOT}/huggingface/hub",
            "TOKENIZERS_PARALLELISM": "false",
        },
    )


@training_function(timeout=900)
def smoke_train() -> dict[str, object]:
    return run_training(
        output_name="synthetic-smoke",
        extra_args=[
            "--max-train-records",
            "16",
            "--max-validation-records",
            "8",
            "--max-steps",
            "2",
            "--epochs",
            "1",
        ],
    )


@training_function(timeout=4 * 60 * 60)
def full_train() -> dict[str, object]:
    return run_training(output_name="synthetic")


def run_training(
    *, output_name: str, extra_args: list[str] | None = None
) -> dict[str, object]:
    import torch

    output_directory = OUTPUT_ROOT / output_name
    command = [
        "python",
        f"{REMOTE_ROOT}/training/train_t5gemma2.py",
        "--config",
        f"{REMOTE_ROOT}/training/t5gemma2-270m/synthetic-pretrain.json",
        "--output-directory",
        str(output_directory),
        *(extra_args or []),
    ]
    started = time.monotonic()
    subprocess.run(command, cwd=REMOTE_ROOT, check=True)
    output_volume.commit()
    cache_volume.commit()
    elapsed = time.monotonic() - started
    result = {
        "completed": True,
        "outputDirectory": str(output_directory),
        "elapsedSeconds": round(elapsed, 2),
        "estimatedA10GpuCostUsd": round(elapsed * 0.000306, 4),
        "gpu": torch.cuda.get_device_name(0),
    }
    (output_directory / "modal-run.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    output_volume.commit()
    return result


@app.local_entrypoint()
def main(mode: str = "diagnose") -> None:
    if mode == "diagnose":
        result = diagnose.remote()
    elif mode == "smoke":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        result = smoke_train.remote()
    elif mode == "full":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        result = full_train.remote()
    else:
        raise ValueError("mode must be diagnose, smoke, or full")
    print(json.dumps(result, indent=2))
