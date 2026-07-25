from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import time

import modal


APP_NAME = "apples-to-apples-training"
MODEL_ID = "google/t5gemma-2-270m-270m"
REPO_ROOT = Path(__file__).resolve().parent.parent
REMOTE_ROOT = Path("/workspace")
OUTPUT_ROOT = Path("/outputs")
CACHE_ROOT = Path("/cache")
SYNTHETIC_DATASET = (
    REPO_ROOT / "benchmark-data" / "training" / "t5gemma2-synthetic"
)
POINTER_DATASET = (
    REPO_ROOT / "benchmark-data" / "training" / "t5gemma2-synthetic-pointer"
)
SILVER_DISCOVERY_DATASET = (
    REPO_ROOT / "benchmark-data" / "training" / "t5gemma2-silver-discovery"
)
ADJUDICATED_DISCOVERY_DATASET = (
    REPO_ROOT / "benchmark-data" / "training" / "t5gemma2-adjudicated-discovery"
)
SILVER_EXTRACTION_DATASET = (
    REPO_ROOT / "benchmark-data" / "training" / "t5gemma2-silver-extraction"
)

if modal.is_local() and not SYNTHETIC_DATASET.is_dir():
    raise RuntimeError(
        "Generate the synthetic dataset before running Modal: "
        "`bun run training:synthetic:generate`"
    )
if modal.is_local() and not POINTER_DATASET.is_dir():
    raise RuntimeError(
        "Generate the evidence-pointer dataset before running Modal: "
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
    .add_local_dir(
        POINTER_DATASET,
        f"{REMOTE_ROOT}/benchmark-data/training/t5gemma2-synthetic-pointer",
        copy=True,
    )
)
if SILVER_DISCOVERY_DATASET.is_dir():
    image = image.add_local_dir(
        SILVER_DISCOVERY_DATASET,
        f"{REMOTE_ROOT}/benchmark-data/training/t5gemma2-silver-discovery",
        copy=True,
    )
if ADJUDICATED_DISCOVERY_DATASET.is_dir():
    image = image.add_local_dir(
        ADJUDICATED_DISCOVERY_DATASET,
        f"{REMOTE_ROOT}/benchmark-data/training/t5gemma2-adjudicated-discovery",
        copy=True,
    )
if SILVER_EXTRACTION_DATASET.is_dir():
    image = image.add_local_dir(
        SILVER_EXTRACTION_DATASET,
        f"{REMOTE_ROOT}/benchmark-data/training/t5gemma2-silver-extraction",
        copy=True,
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


@app.function(
    image=image,
    cpu=1,
    memory=2048,
    timeout=120,
    retries=0,
    single_use_containers=True,
    secrets=[] if huggingface_secret is None else [huggingface_secret],
    volumes={CACHE_ROOT: cache_volume},
    env={
        "HF_HOME": f"{CACHE_ROOT}/huggingface",
        "HF_HUB_CACHE": f"{CACHE_ROOT}/huggingface/hub",
    },
)
def check_model_access(model_id: str = MODEL_ID) -> dict[str, object]:
    from huggingface_hub import hf_hub_download
    from huggingface_hub.errors import GatedRepoError, HfHubHTTPError

    token = os.environ.get("HF_TOKEN")
    if not token:
        return {
            "accessible": False,
            "error": "The Modal secret is missing HF_TOKEN.",
        }

    try:
        hf_hub_download(
            repo_id=model_id,
            filename="config.json",
            token=token,
            cache_dir=f"{CACHE_ROOT}/huggingface/hub",
        )
    except GatedRepoError:
        return {
            "accessible": False,
            "error": (
                "Accept the Gemma usage license at "
                f"https://huggingface.co/{model_id} for the account that owns "
                "the configured Hugging Face token."
            ),
        }
    except HfHubHTTPError as error:
        return {
            "accessible": False,
            "error": f"Hugging Face model access check failed: {error}",
        }

    cache_volume.commit()
    return {"accessible": True, "modelId": model_id}


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


@training_function(timeout=1800)
def pilot_train() -> dict[str, object]:
    return run_training(
        output_name="synthetic-pilot-20",
        extra_args=[
            "--max-train-records",
            "320",
            "--max-validation-records",
            "32",
            "--max-steps",
            "20",
            "--epochs",
            "2",
        ],
    )


@training_function(timeout=1800)
def pilot_continue_train() -> dict[str, object]:
    return run_training(
        output_name="synthetic-pilot-40",
        extra_args=[
            "--initial-adapter",
            f"{OUTPUT_ROOT}/synthetic-pilot-20",
            "--max-train-records",
            "320",
            "--max-validation-records",
            "32",
            "--max-steps",
            "20",
            "--epochs",
            "2",
        ],
    )


@training_function(timeout=1800)
def pilot_focus_extraction_train() -> dict[str, object]:
    return run_training(
        output_name="synthetic-pilot-60-extraction",
        extra_args=[
            "--initial-adapter",
            f"{OUTPUT_ROOT}/synthetic-pilot-40",
            "--train-task",
            "extract-product",
            "--balance-extraction-abstentions",
            "--max-train-records",
            "320",
            "--max-validation-records",
            "32",
            "--max-steps",
            "20",
            "--epochs",
            "2",
        ],
    )


@training_function(timeout=1800)
def pilot_replay_train() -> dict[str, object]:
    return run_training(
        output_name="synthetic-pilot-60-replay",
        extra_args=[
            "--initial-adapter",
            f"{OUTPUT_ROOT}/synthetic-pilot-40",
            "--extraction-share",
            "0.75",
            "--balance-extraction-abstentions",
            "--max-train-records",
            "320",
            "--max-validation-records",
            "32",
            "--max-steps",
            "20",
            "--epochs",
            "2",
        ],
    )


@training_function(timeout=1800)
def pilot_real_discovery_train() -> dict[str, object]:
    return run_training(
        output_name="synthetic-pilot-80-real-discovery",
        config_name="silver-discovery-adaptation.json",
        extra_args=[
            "--initial-adapter",
            f"{OUTPUT_ROOT}/synthetic-pilot-60-replay",
            "--train-task",
            "discover-products",
            "--max-train-records",
            "312",
            "--max-validation-records",
            "32",
            "--max-steps",
            "20",
            "--epochs",
            "2",
        ],
    )


@training_function(timeout=1800)
def pilot_balanced_real_discovery_train() -> dict[str, object]:
    return run_training(
        output_name="synthetic-pilot-100-real-discovery-balanced",
        config_name="silver-discovery-adaptation.json",
        extra_args=[
            "--initial-adapter",
            f"{OUTPUT_ROOT}/synthetic-pilot-80-real-discovery",
            "--silver-discovery-share",
            "0.5",
            "--max-train-records",
            "320",
            "--max-validation-records",
            "32",
            "--max-steps",
            "20",
            "--epochs",
            "2",
        ],
    )


@training_function(timeout=1800)
def pilot_adjudicated_discovery_train() -> dict[str, object]:
    return run_training(
        output_name="synthetic-pilot-120-adjudicated-discovery",
        config_name="adjudicated-discovery-adaptation.json",
        extra_args=[
            "--initial-adapter",
            f"{OUTPUT_ROOT}/synthetic-pilot-100-real-discovery-balanced",
            "--real-discovery-share",
            "0.5",
            "--max-train-records",
            "320",
            "--max-validation-records",
            "32",
            "--max-steps",
            "20",
            "--epochs",
            "2",
        ],
    )


@training_function(timeout=1800)
def pilot_expanded_adjudicated_discovery_train() -> dict[str, object]:
    return run_training(
        output_name="synthetic-pilot-140-expanded-adjudicated-discovery",
        config_name="adjudicated-discovery-adaptation.json",
        extra_args=[
            "--initial-adapter",
            f"{OUTPUT_ROOT}/synthetic-pilot-120-adjudicated-discovery",
            "--real-discovery-share",
            "0.5",
            "--max-train-records",
            "320",
            "--max-validation-records",
            "32",
            "--max-steps",
            "20",
            "--epochs",
            "2",
        ],
    )


@training_function(timeout=1800)
def pilot_audited_extraction_train() -> dict[str, object]:
    return run_training(
        output_name="synthetic-pilot-80-audited-extraction-evidence-pinned",
        config_name="audited-silver-extraction.json",
        extra_args=[
            "--initial-adapter",
            f"{OUTPUT_ROOT}/synthetic-pilot-60-replay",
            "--silver-extraction-share",
            "0.5",
            "--balance-extraction-abstentions",
            "--max-train-records",
            "320",
            "--max-validation-records",
            "64",
            "--max-steps",
            "20",
            "--epochs",
            "2",
        ],
    )


@training_function(timeout=2700)
def pilot_1b_audited_extraction_train() -> dict[str, object]:
    return run_training(
        output_name="t5gemma2-1b-pilot-20-audited-extraction",
        config_directory="t5gemma2-1b",
        config_name="audited-silver-extraction.json",
        extra_args=[
            "--silver-extraction-share",
            "0.5",
            "--balance-extraction-abstentions",
            "--max-train-records",
            "320",
            "--max-validation-records",
            "32",
            "--max-steps",
            "20",
            "--epochs",
            "2",
        ],
    )


@training_function(timeout=2700)
def pilot_1b_explicit_contract_continue_train() -> dict[str, object]:
    return run_training(
        output_name="t5gemma2-1b-pilot-40-explicit-contract",
        config_directory="t5gemma2-1b",
        config_name="audited-silver-extraction.json",
        extra_args=[
            "--initial-adapter",
            f"{OUTPUT_ROOT}/t5gemma2-1b-pilot-20-audited-extraction",
            "--silver-extraction-share",
            "0.5",
            "--balance-extraction-abstentions",
            "--max-train-records",
            "320",
            "--max-validation-records",
            "32",
            "--max-steps",
            "20",
            "--epochs",
            "2",
        ],
    )


@training_function(timeout=1800)
def pilot_1b_evidence_pointer_g1_train() -> dict[str, object]:
    return run_training(
        output_name="t5gemma2-1b-evidence-pointer-g1-pilot-20",
        config_directory="t5gemma2-1b",
        config_name="evidence-pointer-g1.json",
        extra_args=[
            "--train-task",
            "extract-product",
            "--balance-extraction-abstentions",
            "--max-train-records",
            "320",
            "--max-validation-records",
            "32",
            "--max-steps",
            "20",
            "--epochs",
            "1",
        ],
    )


@training_function(timeout=4 * 60 * 60)
def full_train() -> dict[str, object]:
    return run_training(output_name="synthetic")


def run_training(
    *,
    output_name: str,
    extra_args: list[str] | None = None,
    config_directory: str = "t5gemma2-270m",
    config_name: str = "synthetic-pretrain.json",
) -> dict[str, object]:
    import torch

    output_directory = OUTPUT_ROOT / output_name
    command = [
        "python",
        f"{REMOTE_ROOT}/training/train_t5gemma2.py",
        "--config",
        f"{REMOTE_ROOT}/training/{config_directory}/{config_name}",
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
    elif mode == "check-candidates":
        result = {
            model_id: check_model_access.remote(model_id)
            for model_id in [
                MODEL_ID,
                "google/t5gemma-2-1b-1b",
                "google/paligemma2-3b-pt-224",
                "Qwen/Qwen3-VL-2B-Instruct",
            ]
        }
    elif mode == "smoke":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        access = check_model_access.remote()
        if not access["accessible"]:
            raise RuntimeError(str(access["error"]))
        result = smoke_train.remote()
    elif mode == "pilot":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        access = check_model_access.remote()
        if not access["accessible"]:
            raise RuntimeError(str(access["error"]))
        result = pilot_train.remote()
    elif mode == "pilot-continue":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        access = check_model_access.remote()
        if not access["accessible"]:
            raise RuntimeError(str(access["error"]))
        result = pilot_continue_train.remote()
    elif mode == "pilot-focus-extraction":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        access = check_model_access.remote()
        if not access["accessible"]:
            raise RuntimeError(str(access["error"]))
        result = pilot_focus_extraction_train.remote()
    elif mode == "pilot-replay":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        access = check_model_access.remote()
        if not access["accessible"]:
            raise RuntimeError(str(access["error"]))
        result = pilot_replay_train.remote()
    elif mode == "pilot-real-discovery":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        if not SILVER_DISCOVERY_DATASET.is_dir():
            raise RuntimeError(
                "Prepare the silver discovery dataset before this mode: "
                "`bun run training:silver:prepare`"
            )
        access = check_model_access.remote()
        if not access["accessible"]:
            raise RuntimeError(str(access["error"]))
        result = pilot_real_discovery_train.remote()
    elif mode == "pilot-balanced-real-discovery":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        if not SILVER_DISCOVERY_DATASET.is_dir():
            raise RuntimeError(
                "Prepare the silver discovery dataset before this mode: "
                "`bun run training:silver:prepare`"
            )
        access = check_model_access.remote()
        if not access["accessible"]:
            raise RuntimeError(str(access["error"]))
        result = pilot_balanced_real_discovery_train.remote()
    elif mode == "pilot-adjudicated-discovery":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        if not ADJUDICATED_DISCOVERY_DATASET.is_dir():
            raise RuntimeError(
                "Prepare the adjudicated discovery dataset before this mode: "
                "`bun run training:adjudicated:prepare`"
            )
        access = check_model_access.remote()
        if not access["accessible"]:
            raise RuntimeError(str(access["error"]))
        result = pilot_adjudicated_discovery_train.remote()
    elif mode == "pilot-expanded-adjudicated-discovery":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        if not ADJUDICATED_DISCOVERY_DATASET.is_dir():
            raise RuntimeError(
                "Prepare the adjudicated discovery dataset before this mode: "
                "`bun run training:adjudicated:prepare`"
            )
        access = check_model_access.remote()
        if not access["accessible"]:
            raise RuntimeError(str(access["error"]))
        result = pilot_expanded_adjudicated_discovery_train.remote()
    elif mode == "pilot-audited-extraction":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        if not SILVER_EXTRACTION_DATASET.is_dir():
            raise RuntimeError(
                "Prepare the audited silver extraction dataset before this mode: "
                "`bun run training:extraction:prepare`"
            )
        access = check_model_access.remote()
        if not access["accessible"]:
            raise RuntimeError(str(access["error"]))
        result = pilot_audited_extraction_train.remote()
    elif mode == "pilot-1b-audited-extraction":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        if not SILVER_EXTRACTION_DATASET.is_dir():
            raise RuntimeError(
                "Prepare the audited silver extraction dataset before this mode: "
                "`bun run training:extraction:prepare`"
            )
        access = check_model_access.remote("google/t5gemma-2-1b-1b")
        if not access["accessible"]:
            raise RuntimeError(str(access["error"]))
        result = pilot_1b_audited_extraction_train.remote()
    elif mode == "pilot-1b-explicit-contract-continue":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        if not SILVER_EXTRACTION_DATASET.is_dir():
            raise RuntimeError(
                "Prepare the audited silver extraction dataset before this mode: "
                "`bun run training:extraction:prepare`"
            )
        access = check_model_access.remote("google/t5gemma-2-1b-1b")
        if not access["accessible"]:
            raise RuntimeError(str(access["error"]))
        result = pilot_1b_explicit_contract_continue_train.remote()
    elif mode == "pilot-1b-evidence-pointer-g1":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        if not POINTER_DATASET.is_dir():
            raise RuntimeError(
                "Generate the evidence-pointer dataset before this mode: "
                "`bun run training:synthetic:generate`"
            )
        access = check_model_access.remote("google/t5gemma-2-1b-1b")
        if not access["accessible"]:
            raise RuntimeError(str(access["error"]))
        result = pilot_1b_evidence_pointer_g1_train.remote()
    elif mode == "full":
        if diagnose_only:
            raise RuntimeError("Training functions are disabled in diagnostic mode")
        access = check_model_access.remote()
        if not access["accessible"]:
            raise RuntimeError(str(access["error"]))
        result = full_train.remote()
    else:
        raise ValueError(
            "mode must be diagnose, smoke, pilot, pilot-continue, "
            "pilot-focus-extraction, pilot-replay, pilot-real-discovery, "
            "pilot-balanced-real-discovery, pilot-adjudicated-discovery, "
            "check-candidates, pilot-expanded-adjudicated-discovery, "
            "pilot-audited-extraction, pilot-1b-audited-extraction, "
            "pilot-1b-explicit-contract-continue, "
            "pilot-1b-evidence-pointer-g1, "
            "or full"
        )
    print(json.dumps(result, indent=2))
