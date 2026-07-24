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
    parser.add_argument(
        "--output-directory",
        help="Override the configured output directory.",
    )
    parser.add_argument(
        "--max-train-records",
        type=int,
        help="Deterministically limit training records for a smoke run.",
    )
    parser.add_argument(
        "--max-validation-records",
        type=int,
        help="Deterministically limit validation records for a smoke run.",
    )
    parser.add_argument(
        "--max-steps",
        type=int,
        help="Override Trainer max_steps for a bounded smoke run.",
    )
    parser.add_argument(
        "--epochs",
        type=float,
        help="Override the configured epoch count.",
    )
    parser.add_argument(
        "--initial-adapter",
        help="Override the initial LoRA adapter path for a continuation run.",
    )
    parser.add_argument(
        "--train-task",
        choices=("discover-products", "extract-product"),
        help="Train on one task only for a targeted research run.",
    )
    parser.add_argument(
        "--balance-extraction-abstentions",
        action="store_true",
        help="Balance positive and abstaining extraction records before limiting.",
    )
    parser.add_argument(
        "--extraction-share",
        type=float,
        help="Mix extraction records with discovery replay at this share (0-1).",
    )
    parser.add_argument(
        "--silver-discovery-share",
        type=float,
        help=(
            "Mix real-DOM silver discovery records with synthetic discovery replay "
            "at this share (0-1)."
        ),
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


def sanitize_token_ids(
    token_ids: Any, *, pad_token_id: int, vocabulary_size: int
) -> list[list[int]]:
    rows = token_ids.tolist() if hasattr(token_ids, "tolist") else token_ids
    return [
        [
            value if 0 <= (value := int(token_id)) < vocabulary_size else pad_token_id
            for token_id in row
        ]
        for row in rows
    ]


def has_json_prefix(value: str) -> bool:
    try:
        json.JSONDecoder().raw_decode(value.lstrip())
        return True
    except json.JSONDecodeError:
        return False


def parse_json_prefix(value: str) -> tuple[bool, Any]:
    try:
        parsed, _ = json.JSONDecoder().raw_decode(value.lstrip())
        return True, parsed
    except json.JSONDecodeError:
        return False, None


def validate_dataset(
    repo_root: Path, config: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]], Path]:
    manifest_path = resolve_from_repo(repo_root, config["datasetManifest"])
    manifest = load_json(manifest_path)
    if manifest.get("version") != 1:
        raise ValueError("Unsupported dataset manifest version")
    silver_discovery = (
        config.get("allowSilverDiscovery") is True
        and manifest.get("datasetType")
        == "synthetic-plus-silver-real-discovery"
    )
    if not silver_discovery and (
        manifest.get("strict") is not True
        or manifest.get("allowSingleReview") is not False
    ):
        raise ValueError("Training requires a strict, dual-reviewed dataset manifest")
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
            if silver_discovery and record.get("task") != "discover-products":
                raise ValueError(
                    f"{record.get('id')}: silver adaptation may train discovery only"
                )
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
    max_steps: int | None,
) -> None:
    try:
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

    output_directory = resolve_from_repo(repo_root, config["outputDirectory"])
    evaluation_records = stratified_limit(
        records_by_split["validation"],
        config["evaluation"]["generationSamples"],
    )

    def compute_metrics(eval_prediction: Any) -> dict[str, float]:
        predictions, labels = eval_prediction
        if isinstance(predictions, tuple):
            predictions = predictions[0]
        vocabulary_size = len(processor.tokenizer)
        predictions = sanitize_token_ids(
            predictions,
            pad_token_id=processor.tokenizer.pad_token_id,
            vocabulary_size=vocabulary_size,
        )
        labels = sanitize_token_ids(
            labels,
            pad_token_id=processor.tokenizer.pad_token_id,
            vocabulary_size=vocabulary_size,
        )
        decoded_predictions = processor.batch_decode(
            predictions, skip_special_tokens=True
        )
        decoded_labels = processor.batch_decode(labels, skip_special_tokens=True)
        valid_json = 0
        recoverable_json = 0
        prefix_exact = 0
        exact = 0
        discovery_count = 0
        discovery_exact = 0
        extraction_count = 0
        extraction_exact = 0
        extraction_field_matches = 0
        extraction_field_total = 0
        abstention_count = 0
        abstention_matches = 0
        samples = []
        for record, prediction, label in zip(
            evaluation_records,
            decoded_predictions,
            decoded_labels,
            strict=True,
        ):
            is_valid_json = True
            try:
                json.loads(prediction)
                valid_json += 1
            except json.JSONDecodeError:
                is_valid_json = False
            is_recoverable_json, parsed_prediction = parse_json_prefix(prediction)
            if is_recoverable_json:
                recoverable_json += 1
            parsed_label = json.loads(label)
            is_prefix_exact = (
                is_recoverable_json and parsed_prediction == parsed_label
            )
            if is_prefix_exact:
                prefix_exact += 1
            if record["task"] == "discover-products":
                discovery_count += 1
                discovery_exact += int(is_prefix_exact)
            else:
                extraction_count += 1
                extraction_exact += int(is_prefix_exact)
                predicted_product = (
                    parsed_prediction.get("products", [{}])[0]
                    if isinstance(parsed_prediction, dict)
                    and parsed_prediction.get("products")
                    else {}
                )
                target_product = parsed_label["products"][0]
                for field in (
                    "cardNodeId",
                    "title",
                    "currentPrice",
                    "nativeUnitPrice",
                    "packageQuantity",
                    "abstainReason",
                ):
                    extraction_field_total += 1
                    extraction_field_matches += int(
                        predicted_product.get(field, "__missing__")
                        == target_product.get(field, "__missing__")
                    )
                if "abstainReason" in target_product:
                    abstention_count += 1
                    abstention_matches += int(
                        predicted_product.get("abstainReason")
                        == target_product["abstainReason"]
                    )
            is_exact = prediction.strip() == label.strip()
            if is_exact:
                exact += 1
            samples.append(
                {
                    "task": record["task"],
                    "siteId": record["siteId"],
                    "pageId": record["pageId"],
                    "validJson": is_valid_json,
                    "recoverableJson": is_recoverable_json,
                    "prefixExact": is_prefix_exact,
                    "exactMatch": is_exact,
                    "prediction": prediction,
                    "target": label,
                }
            )
        count = max(1, len(decoded_predictions))
        metrics = {
            "json_valid": valid_json / count,
            "json_recoverable": recoverable_json / count,
            "json_prefix_exact": prefix_exact / count,
            "discovery_prefix_exact": discovery_exact / max(1, discovery_count),
            "extraction_prefix_exact": extraction_exact / max(1, extraction_count),
            "extraction_field_accuracy": extraction_field_matches
            / max(1, extraction_field_total),
            "abstention_accuracy": abstention_matches / max(1, abstention_count),
            "exact_match": exact / count,
        }
        output_directory.mkdir(parents=True, exist_ok=True)
        (output_directory / "evaluation-samples.jsonl").write_text(
            "".join(json.dumps(sample) + "\n" for sample in samples),
            encoding="utf-8",
        )
        (output_directory / "evaluation-summary.json").write_text(
            json.dumps(
                {
                    "records": count,
                    "jsonValid": metrics["json_valid"],
                    "jsonRecoverable": metrics["json_recoverable"],
                    "jsonPrefixExact": metrics["json_prefix_exact"],
                    "discoveryPrefixExact": metrics["discovery_prefix_exact"],
                    "extractionPrefixExact": metrics["extraction_prefix_exact"],
                    "extractionFieldAccuracy": metrics[
                        "extraction_field_accuracy"
                    ],
                    "abstentionAccuracy": metrics["abstention_accuracy"],
                    "exactMatch": metrics["exact_match"],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return metrics

    set_seed(config["seed"])
    evaluation_steps = config["evaluation"]["steps"]
    save_steps = config["evaluation"]["saveSteps"]
    if max_steps is not None:
        evaluation_steps = min(evaluation_steps, max_steps)
        save_steps = min(save_steps, max_steps)
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
        eval_steps=evaluation_steps,
        save_steps=save_steps,
        save_total_limit=3,
        predict_with_generate=True,
        generation_max_length=config["maxOutputTokens"],
        load_best_model_at_end=True,
        metric_for_best_model="json_prefix_exact",
        greater_is_better=True,
        remove_unused_columns=False,
        report_to="none",
        seed=config["seed"],
        **({"max_steps": max_steps} if max_steps is not None else {}),
    )
    trainer = Seq2SeqTrainer(
        model=model,
        args=arguments,
        train_dataset=ShoppingDataset(records_by_split["train"]),
        eval_dataset=ShoppingDataset(evaluation_records),
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
                "trainingSelection": {
                    "records": len(records_by_split["train"]),
                    "uniqueRecords": len(
                        {record["id"] for record in records_by_split["train"]}
                    ),
                    "silverDiscoveryRecords": sum(
                        str(record.get("captureId", "")).startswith("silver-")
                        for record in records_by_split["train"]
                    ),
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    trainer.train()
    trainer.save_model()
    processor.save_pretrained(output_directory)


def stratified_limit(
    records: list[dict[str, Any]], limit: int | None
) -> list[dict[str, Any]]:
    if limit is None or limit >= len(records):
        return records
    if limit <= 0:
        raise ValueError("Record limits must be positive")
    tasks = ("discover-products", "extract-product")
    buckets = {
        task: [record for record in records if record["task"] == task] for task in tasks
    }
    selected: list[dict[str, Any]] = []
    while len(selected) < limit:
        added = False
        for task in tasks:
            bucket = buckets[task]
            index = len([record for record in selected if record["task"] == task])
            if index < len(bucket) and len(selected) < limit:
                selected.append(bucket[index])
                added = True
        if not added:
            break
    return selected


def balanced_extraction_limit(
    records: list[dict[str, Any]], limit: int | None
) -> list[dict[str, Any]]:
    extraction_records = [
        record for record in records if record["task"] == "extract-product"
    ]
    target_count = (
        len(extraction_records)
        if limit is None
        else min(limit, len(extraction_records))
    )
    if target_count <= 0:
        raise ValueError("Record limits must be positive")
    abstaining = []
    positive = []
    for record in extraction_records:
        product = json.loads(record["target"])["products"][0]
        (abstaining if "abstainReason" in product else positive).append(record)
    selected = []
    positive_index = 0
    abstaining_index = 0
    while len(selected) < target_count:
        added = False
        if positive_index < len(positive) and len(selected) < target_count:
            selected.append(positive[positive_index])
            positive_index += 1
            added = True
        if abstaining_index < len(abstaining) and len(selected) < target_count:
            selected.append(abstaining[abstaining_index])
            abstaining_index += 1
            added = True
        if not added:
            break
    return selected


def mixed_task_limit(
    records: list[dict[str, Any]],
    limit: int,
    *,
    extraction_share: float,
    balance_extraction_abstentions: bool,
) -> list[dict[str, Any]]:
    if limit <= 0:
        raise ValueError("Record limits must be positive")
    if not 0 < extraction_share < 1:
        raise ValueError("--extraction-share must be between 0 and 1")
    extraction_count = round(limit * extraction_share)
    discovery_count = limit - extraction_count
    if balance_extraction_abstentions:
        extraction = balanced_extraction_limit(records, extraction_count)
    else:
        extraction = [
            record for record in records if record["task"] == "extract-product"
        ][:extraction_count]
    discovery = [
        record for record in records if record["task"] == "discover-products"
    ][:discovery_count]
    if len(extraction) != extraction_count or len(discovery) != discovery_count:
        raise ValueError("Not enough records for the requested task mixture")

    selected = []
    extraction_index = 0
    discovery_index = 0
    while len(selected) < limit:
        expected_extraction = round(
            (len(selected) + 1) * extraction_share
        )
        if extraction_index < expected_extraction:
            selected.append(extraction[extraction_index])
            extraction_index += 1
        elif discovery_index < len(discovery):
            selected.append(discovery[discovery_index])
            discovery_index += 1
        elif extraction_index < len(extraction):
            selected.append(extraction[extraction_index])
            extraction_index += 1
    return selected


def mixed_silver_discovery_limit(
    records: list[dict[str, Any]], limit: int, *, silver_share: float
) -> list[dict[str, Any]]:
    if limit <= 0:
        raise ValueError("Record limits must be positive")
    if not 0 < silver_share < 1:
        raise ValueError("--silver-discovery-share must be between 0 and 1")
    if any(record["task"] != "discover-products" for record in records):
        raise ValueError("--silver-discovery-share requires discovery-only records")
    silver = [
        record
        for record in records
        if str(record.get("captureId", "")).startswith("silver-")
    ]
    synthetic = [
        record
        for record in records
        if not str(record.get("captureId", "")).startswith("silver-")
    ]
    if not silver or not synthetic:
        raise ValueError("Silver and synthetic discovery records are both required")

    selected = []
    silver_index = 0
    synthetic_index = 0
    while len(selected) < limit:
        expected_silver = round((len(selected) + 1) * silver_share)
        if silver_index < expected_silver:
            selected.append(silver[silver_index % len(silver)])
            silver_index += 1
        else:
            selected.append(synthetic[synthetic_index % len(synthetic)])
            synthetic_index += 1
    return selected


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    config_path = resolve_from_repo(repo_root, args.config)
    config = load_json(config_path)
    if args.output_directory:
        config["outputDirectory"] = args.output_directory
    if args.initial_adapter:
        config["initialAdapter"] = args.initial_adapter
    if args.epochs is not None:
        if args.epochs <= 0:
            raise ValueError("--epochs must be positive")
        config["training"]["epochs"] = args.epochs
    if args.max_steps is not None and args.max_steps <= 0:
        raise ValueError("--max-steps must be positive")
    manifest, records_by_split, dataset_root = validate_dataset(repo_root, config)
    print_validation_summary(config, manifest, records_by_split)
    if not args.validate_only:
        if args.extraction_share is not None and args.max_train_records is None:
            raise ValueError("--extraction-share requires --max-train-records")
        if args.extraction_share is not None and args.train_task:
            raise ValueError("--extraction-share cannot be combined with --train-task")
        if args.silver_discovery_share is not None and args.max_train_records is None:
            raise ValueError("--silver-discovery-share requires --max-train-records")
        if args.silver_discovery_share is not None and (
            args.extraction_share is not None or args.balance_extraction_abstentions
        ):
            raise ValueError(
                "--silver-discovery-share cannot be combined with extraction sampling"
            )
        if (
            args.balance_extraction_abstentions
            and args.train_task != "extract-product"
            and args.extraction_share is None
        ):
            raise ValueError(
                "--balance-extraction-abstentions requires "
                "--train-task extract-product or --extraction-share"
            )
        if args.silver_discovery_share is not None:
            records_by_split["train"] = mixed_silver_discovery_limit(
                records_by_split["train"],
                args.max_train_records,
                silver_share=args.silver_discovery_share,
            )
        elif args.extraction_share is not None:
            records_by_split["train"] = mixed_task_limit(
                records_by_split["train"],
                args.max_train_records,
                extraction_share=args.extraction_share,
                balance_extraction_abstentions=args.balance_extraction_abstentions,
            )
        elif args.balance_extraction_abstentions:
            records_by_split["train"] = balanced_extraction_limit(
                records_by_split["train"], args.max_train_records
            )
        else:
            training_records = records_by_split["train"]
            if args.train_task:
                training_records = [
                    record
                    for record in training_records
                    if record["task"] == args.train_task
                ]
            records_by_split["train"] = stratified_limit(
                training_records, args.max_train_records
            )
        records_by_split["validation"] = stratified_limit(
            records_by_split["validation"], args.max_validation_records
        )
        train(
            repo_root,
            config,
            manifest,
            records_by_split,
            dataset_root,
            args.allow_non_cuda,
            args.max_steps,
        )


if __name__ == "__main__":
    main()
