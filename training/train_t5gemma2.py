#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fine-tune T5Gemma 2 on evidence-grounded shopping extraction records."
    )
    parser.add_argument(
        "--config",
        default="training/t5gemma2-270m/config.json",
        help="Training configuration JSON, relative to the repository root.",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate configuration, records, targets, and image crops without loading ML dependencies.",
    )
    parser.add_argument(
        "--allow-non-cuda",
        action="store_true",
        help="Allow training without CUDA. Intended only for tiny debugging runs.",
    )
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise ValueError(f"{path}:{line_number}: invalid JSON: {error}") from error
    return records


def resolve_from_repo(repo_root: Path, value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else repo_root / path


def validate_dataset(
    repo_root: Path, config: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]], Path]:
    manifest_path = resolve_from_repo(repo_root, config["datasetManifest"])
    manifest = load_json(manifest_path)
    if manifest.get("version") != 1:
        raise ValueError("Unsupported dataset manifest version")
    if manifest.get("strict") is not True or manifest.get("allowSingleReview") is not False:
        raise ValueError(
            "Training requires a strict, dual-reviewed dataset manifest"
        )
    dataset_root = manifest_path.parent
    records_by_split: dict[str, list[dict[str, Any]]] = {}
    record_ids: set[str] = set()
    domains_by_split: dict[str, set[str]] = {}
    referenced_assets: set[str] = set()

    for split in ("train", "validation"):
        file_path = dataset_root / manifest["files"][split]
        records = load_jsonl(file_path)
        if not records:
            raise ValueError(f"{split} dataset is empty: {file_path}")
        split_domains: set[str] = set()
        for record in records:
            if record.get("version") != 1:
                raise ValueError(f"{record.get('id')}: unsupported record version")
            if record.get("split") != split:
                raise ValueError(f"{record.get('id')}: expected split {split}")
            if record.get("task") not in {"discover-products", "extract-product"}:
                raise ValueError(f"{record.get('id')}: unsupported task")
            record_id = record.get("id")
            if not isinstance(record_id, str) or record_id in record_ids:
                raise ValueError(f"Missing or duplicate record id: {record_id}")
            record_ids.add(record_id)
            site_id = record.get("siteId")
            if not isinstance(site_id, str) or not site_id:
                raise ValueError(f"{record_id}: missing siteId")
            split_domains.add(site_id)
            validate_target(record_id, record["task"], record["target"])
            image_relative = record.get("imagePath")
            if not isinstance(image_relative, str):
                raise ValueError(f"{record_id}: invalid imagePath")
            image_path = safe_dataset_path(dataset_root, image_relative)
            referenced_assets.add(image_relative)
            if not image_path.is_file():
                raise ValueError(f"{record_id}: missing image {image_path}")
            crop = record["imageCrop"]
            crop_values = [crop.get(key) for key in ("x", "y", "width", "height")]
            if (
                not all(isinstance(value, int) for value in crop_values)
                or min(crop["width"], crop["height"]) <= 0
                or min(crop["x"], crop["y"]) < 0
            ):
                raise ValueError(f"{record_id}: invalid image crop {crop}")
            if not record.get("prompt", "").startswith("<start_of_image>\n"):
                raise ValueError(f"{record_id}: prompt is missing <start_of_image>")
            image_width, image_height = png_dimensions(image_path)
            if (
                crop["x"] + crop["width"] > image_width
                or crop["y"] + crop["height"] > image_height
            ):
                raise ValueError(
                    f"{record_id}: crop {crop} exceeds {image_width}x{image_height} image"
                )
        records_by_split[split] = records
        domains_by_split[split] = split_domains

    overlap = domains_by_split["train"] & domains_by_split["validation"]
    if overlap:
        raise ValueError(
            f"Train and validation domains overlap: {', '.join(sorted(overlap))}"
        )
    observed_domains = sorted(domains_by_split["train"] | domains_by_split["validation"])
    if observed_domains != sorted(manifest["domains"]):
        raise ValueError("Manifest domains do not match record domains")

    assets = manifest.get("assets")
    if not isinstance(assets, list):
        raise ValueError("Manifest assets must be a list")
    manifest_assets: set[str] = set()
    for asset in assets:
        relative_path = asset.get("path")
        expected_hash = asset.get("sha256")
        if not isinstance(relative_path, str) or not isinstance(expected_hash, str):
            raise ValueError(f"Invalid asset manifest entry: {asset}")
        if relative_path in manifest_assets:
            raise ValueError(f"Duplicate asset manifest entry: {relative_path}")
        manifest_assets.add(relative_path)
        image_path = safe_dataset_path(dataset_root, relative_path)
        actual_hash = hashlib.sha256(image_path.read_bytes()).hexdigest()
        if actual_hash != expected_hash:
            raise ValueError(f"Asset hash does not match manifest: {relative_path}")
    if referenced_assets != manifest_assets:
        raise ValueError("Referenced image assets do not match the manifest")

    source_hashes = manifest.get("sourceHashes")
    if source_hashes is not None:
        if not isinstance(source_hashes, list) or len(source_hashes) != manifest["pages"]:
            raise ValueError("Synthetic source hashes must cover every page")
        for source in source_hashes:
            for path_key, hash_key in (
                ("htmlPath", "htmlSha256"),
                ("observationPath", "observationSha256"),
                ("annotationPath", "annotationSha256"),
            ):
                relative_path = source.get(path_key)
                expected_hash = source.get(hash_key)
                if not isinstance(relative_path, str) or not isinstance(
                    expected_hash, str
                ):
                    raise ValueError(f"Invalid source hash entry: {source}")
                source_path = safe_dataset_path(dataset_root, relative_path)
                actual_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
                if actual_hash != expected_hash:
                    raise ValueError(
                        f"Source hash does not match manifest: {relative_path}"
                    )

    serialized_hash = hashlib.sha256()
    for split in ("train", "validation"):
        serialized_hash.update(
            (dataset_root / manifest["files"][split]).read_bytes()
        )
    if serialized_hash.hexdigest() != manifest["sha256"]:
        raise ValueError("Dataset JSONL hash does not match dataset-manifest.json")
    expected_records = manifest.get("records", {})
    actual_records = {
        "train": len(records_by_split["train"]),
        "validation": len(records_by_split["validation"]),
        "discovery": sum(
            record["task"] == "discover-products"
            for records in records_by_split.values()
            for record in records
        ),
        "extraction": sum(
            record["task"] == "extract-product"
            for records in records_by_split.values()
            for record in records
        ),
    }
    if expected_records != actual_records:
        raise ValueError(
            f"Manifest record counts do not match records: {actual_records}"
        )
    return manifest, records_by_split, dataset_root


def safe_dataset_path(dataset_root: Path, relative_path: str) -> Path:
    candidate = (dataset_root / relative_path).resolve()
    try:
        candidate.relative_to(dataset_root.resolve())
    except ValueError as error:
        raise ValueError(f"Dataset path escapes its root: {relative_path}") from error
    return candidate


def validate_target(record_id: str, task: str, serialized: str) -> None:
    if not isinstance(serialized, str):
        raise ValueError(f"{record_id}: target must be serialized JSON")
    target = json.loads(serialized)
    if target.get("version") != 1 or not isinstance(target.get("pageId"), str):
        raise ValueError(f"{record_id}: target has an invalid envelope")
    if task == "discover-products":
        node_ids = target.get("cardNodeIds")
        if (
            not isinstance(node_ids, list)
            or not all(isinstance(node_id, str) and node_id for node_id in node_ids)
            or len(node_ids) != len(set(node_ids))
        ):
            raise ValueError(f"{record_id}: invalid discovery target")
        return
    products = target.get("products")
    if not isinstance(products, list) or len(products) != 1:
        raise ValueError(f"{record_id}: extraction target must contain one product")
    product = products[0]
    if not isinstance(product, dict) or not isinstance(product.get("cardNodeId"), str):
        raise ValueError(f"{record_id}: invalid extraction product")


def png_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        header = handle.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"Training asset is not a valid PNG header: {path}")
    return struct.unpack(">II", header[16:24])


def print_validation_summary(
    config: dict[str, Any],
    manifest: dict[str, Any],
    records_by_split: dict[str, list[dict[str, Any]]],
) -> None:
    summary = {
        "valid": True,
        "modelId": config["modelId"],
        "datasetType": manifest.get("datasetType", "adjudicated-real"),
        "datasetSha256": manifest["sha256"],
        "pages": manifest["pages"],
        "domains": len(manifest["domains"]),
        "products": manifest["products"],
        "records": {
            split: len(records) for split, records in records_by_split.items()
        },
    }
    print(json.dumps(summary, indent=2))


def train(
    repo_root: Path,
    config: dict[str, Any],
    manifest: dict[str, Any],
    records_by_split: dict[str, list[dict[str, Any]]],
    dataset_root: Path,
    allow_non_cuda: bool,
) -> None:
    try:
        import numpy as np
        import torch
        from PIL import Image
        from peft import LoraConfig, PeftModel, TaskType, get_peft_model
        from torch.utils.data import Dataset
        from transformers import (
            AutoModelForSeq2SeqLM,
            AutoProcessor,
            Seq2SeqTrainer,
            Seq2SeqTrainingArguments,
            set_seed,
        )
    except ImportError as error:
        raise RuntimeError(
            "Training dependencies are missing. Run `uv sync --project training`."
        ) from error

    if not torch.cuda.is_available() and not allow_non_cuda:
        raise RuntimeError(
            "CUDA is required for the configured run. Use a GPU host or pass "
            "--allow-non-cuda only for a tiny debugging run."
        )
    if not os.environ.get("HF_TOKEN"):
        raise RuntimeError(
            "HF_TOKEN is required because the T5Gemma 2 weights require accepting "
            "Google's access terms on Hugging Face."
        )

    class ShoppingDataset(Dataset):
        def __init__(self, records: list[dict[str, Any]]) -> None:
            self.records = records

        def __len__(self) -> int:
            return len(self.records)

        def __getitem__(self, index: int) -> dict[str, Any]:
            return self.records[index]

    processor = AutoProcessor.from_pretrained(
        config["modelId"], token=os.environ["HF_TOKEN"]
    )
    dtype = (
        torch.bfloat16
        if config["training"]["bf16"] and torch.cuda.is_available()
        else torch.float32
    )
    model = AutoModelForSeq2SeqLM.from_pretrained(
        config["modelId"], token=os.environ["HF_TOKEN"], dtype=dtype
    )
    initial_adapter = config.get("initialAdapter")
    if initial_adapter:
        adapter_path = resolve_from_repo(repo_root, initial_adapter)
        if not adapter_path.is_dir():
            raise RuntimeError(f"Initial adapter does not exist: {adapter_path}")
        model = PeftModel.from_pretrained(
            model,
            adapter_path,
            is_trainable=True,
        )
    elif config["training"]["method"] == "lora":
        lora = LoraConfig(
            task_type=TaskType.SEQ_2_SEQ_LM,
            r=config["training"]["loraRank"],
            lora_alpha=config["training"]["loraAlpha"],
            lora_dropout=config["training"]["loraDropout"],
            target_modules=config["training"]["targetModules"],
        )
        model = get_peft_model(model, lora)
    if config["training"]["gradientCheckpointing"]:
        model.gradient_checkpointing_enable()
    model.config.use_cache = False

    def collate(batch: list[dict[str, Any]]) -> dict[str, Any]:
        images = []
        for record in batch:
            crop = record["imageCrop"]
            with Image.open(dataset_root / record["imagePath"]) as image:
                images.append(
                    image.convert("RGB").crop(
                        (
                            crop["x"],
                            crop["y"],
                            crop["x"] + crop["width"],
                            crop["y"] + crop["height"],
                        )
                    )
                )
        model_inputs = processor(
            text=[record["prompt"] for record in batch],
            images=images,
            padding=True,
            truncation=True,
            max_length=config["maxInputTokens"],
            return_tensors="pt",
        )
        labels = processor.tokenizer(
            text_target=[record["target"] for record in batch],
            padding=True,
            truncation=True,
            max_length=config["maxOutputTokens"],
            return_tensors="pt",
        )["input_ids"]
        labels[labels == processor.tokenizer.pad_token_id] = -100
        model_inputs["labels"] = labels
        return model_inputs

    def compute_metrics(eval_prediction: Any) -> dict[str, float]:
        predictions, labels = eval_prediction
        if isinstance(predictions, tuple):
            predictions = predictions[0]
        labels = np.where(labels != -100, labels, processor.tokenizer.pad_token_id)
        decoded_predictions = processor.batch_decode(
            predictions, skip_special_tokens=True
        )
        decoded_labels = processor.batch_decode(labels, skip_special_tokens=True)
        valid_json = 0
        exact = 0
        for prediction, label in zip(decoded_predictions, decoded_labels, strict=True):
            try:
                json.loads(prediction)
                valid_json += 1
            except json.JSONDecodeError:
                pass
            if prediction.strip() == label.strip():
                exact += 1
        count = max(1, len(decoded_predictions))
        return {"json_valid": valid_json / count, "exact_match": exact / count}

    set_seed(config["seed"])
    output_directory = resolve_from_repo(repo_root, config["outputDirectory"])
    arguments = Seq2SeqTrainingArguments(
        output_dir=str(output_directory),
        num_train_epochs=config["training"]["epochs"],
        learning_rate=config["training"]["learningRate"],
        weight_decay=config["training"]["weightDecay"],
        warmup_ratio=config["training"]["warmupRatio"],
        per_device_train_batch_size=config["training"]["batchSize"],
        per_device_eval_batch_size=config["training"]["batchSize"],
        gradient_accumulation_steps=config["training"][
            "gradientAccumulationSteps"
        ],
        gradient_checkpointing=config["training"]["gradientCheckpointing"],
        bf16=config["training"]["bf16"] and torch.cuda.is_available(),
        eval_strategy="steps",
        eval_steps=config["evaluation"]["steps"],
        save_steps=config["evaluation"]["saveSteps"],
        save_total_limit=3,
        predict_with_generate=True,
        generation_max_length=config["maxOutputTokens"],
        load_best_model_at_end=True,
        metric_for_best_model="json_valid",
        greater_is_better=True,
        remove_unused_columns=False,
        report_to="none",
        seed=config["seed"],
    )
    trainer = Seq2SeqTrainer(
        model=model,
        args=arguments,
        train_dataset=ShoppingDataset(records_by_split["train"]),
        eval_dataset=ShoppingDataset(records_by_split["validation"]),
        data_collator=collate,
        processing_class=processor,
        compute_metrics=compute_metrics,
    )
    output_directory.mkdir(parents=True, exist_ok=True)
    (output_directory / "run-provenance.json").write_text(
        json.dumps(
            {
                "config": config,
                "datasetSha256": manifest["sha256"],
                "datasetManifest": config["datasetManifest"],
                "initialAdapter": initial_adapter,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    trainer.train()
    trainer.save_model()
    processor.save_pretrained(output_directory)


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    config_path = resolve_from_repo(repo_root, args.config)
    config = load_json(config_path)
    manifest, records_by_split, dataset_root = validate_dataset(repo_root, config)
    print_validation_summary(config, manifest, records_by_split)
    if not args.validate_only:
        train(
            repo_root,
            config,
            manifest,
            records_by_split,
            dataset_root,
            args.allow_non_cuda,
        )


if __name__ == "__main__":
    main()
