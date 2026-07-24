#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import time
from typing import Any

from train_t5gemma2 import (
    load_json,
    mixed_real_discovery_limit,
    resolve_from_repo,
    sanitize_token_ids,
    stratified_limit,
    validate_dataset,
)


MODEL_ID = "google/pix2struct-base"
OBSERVATION_MARKER = "OBSERVATION: "


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the screenshot-native Pix2Struct discovery baseline."
    )
    parser.add_argument(
        "--config",
        default="training/pix2struct-base/discovery-baseline.json",
    )
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--allow-non-cuda", action="store_true")
    parser.add_argument("--output-directory")
    parser.add_argument("--initial-checkpoint")
    parser.add_argument("--max-train-records", type=int)
    parser.add_argument("--max-validation-records", type=int)
    parser.add_argument("--max-steps", type=int)
    parser.add_argument("--real-discovery-share", type=float, default=0.5)
    return parser.parse_args()


def visual_header(page_id: str, target_format: str = "json") -> str:
    if target_format == "compact-tags":
        return (
            "Find every complete product card. Output only "
            "<cards><card>x,y,width,height</card></cards> with coordinates "
            "from 0 to 1000. Use <cards></cards> when there are no products."
        )
    return (
        "Find every complete product card. Return JSON only with version 1, "
        f'pageId "{page_id}", and cardBoxes. Each box has x, y, width, and '
        "height from 0 to 1000. Return an empty cardBoxes list when no products."
    )


def visual_target(
    record: dict[str, Any], target_format: str = "json"
) -> str:
    target = json.loads(record["target"])
    observation = parse_observation(record["prompt"])
    nodes = {node["id"]: node for node in observation["nodes"]}
    boxes = [
        normalize_node_box(
            nodes[node_id]["bounds"], record["metadata"]["sourceRegion"]
        )
        for node_id in target["cardNodeIds"]
    ]
    if target_format == "compact-tags":
        cards = "".join(
            f'<card>{box["x"]},{box["y"]},{box["width"]},{box["height"]}</card>'
            for box in boxes
        )
        return f"<cards>{cards}</cards>"
    return json.dumps(
        {
            "version": 1,
            "pageId": record["pageId"],
            "cardBoxes": boxes,
        },
        separators=(",", ":"),
    )


def parse_observation(prompt: str) -> dict[str, Any]:
    marker = prompt.find(OBSERVATION_MARKER)
    if marker < 0:
        raise ValueError("Discovery prompt is missing OBSERVATION")
    return json.loads(prompt[marker + len(OBSERVATION_MARKER) :])


def normalize_node_box(
    bounds: dict[str, float], crop: dict[str, float]
) -> dict[str, int]:
    left = max(float(bounds["x"]), float(crop["x"]))
    top = max(float(bounds["y"]), float(crop["y"]))
    right = min(
        float(bounds["x"]) + float(bounds["width"]),
        float(crop["x"]) + float(crop["width"]),
    )
    bottom = min(
        float(bounds["y"]) + float(bounds["height"]),
        float(crop["y"]) + float(crop["height"]),
    )
    if right <= left or bottom <= top:
        raise ValueError("Card root does not intersect its screenshot crop")

    x = normalized_coordinate(left - float(crop["x"]), float(crop["width"]))
    y = normalized_coordinate(top - float(crop["y"]), float(crop["height"]))
    right_normalized = normalized_coordinate(
        right - float(crop["x"]), float(crop["width"])
    )
    bottom_normalized = normalized_coordinate(
        bottom - float(crop["y"]), float(crop["height"])
    )
    width = max(1, right_normalized - x)
    height = max(1, bottom_normalized - y)
    return {
        "x": min(x, 999),
        "y": min(y, 999),
        "width": min(width, 1000 - min(x, 999)),
        "height": min(height, 1000 - min(y, 999)),
    }


def normalized_coordinate(value: float, extent: float) -> int:
    return max(0, min(1000, round((value / extent) * 1000)))


def parse_visual_prediction(
    prediction: str, expected_page_id: str, target_format: str = "json"
) -> list[dict[str, float]] | None:
    if target_format == "compact-tags":
        return parse_compact_prediction(prediction)
    try:
        parsed = json.loads(prediction)
    except json.JSONDecodeError:
        return None
    if (
        not isinstance(parsed, dict)
        or parsed.get("version") != 1
        or parsed.get("pageId") != expected_page_id
        or not isinstance(parsed.get("cardBoxes"), list)
    ):
        return None
    boxes = parsed["cardBoxes"]
    return boxes if all(valid_box(box) for box in boxes) else None


def parse_compact_prediction(
    prediction: str,
) -> list[dict[str, float]] | None:
    import re

    value = prediction.strip()
    if not value.startswith("<cards>") or not value.endswith("</cards>"):
        return None
    inner = value[len("<cards>") : -len("</cards>")]
    if not inner:
        return []
    matches = re.findall(r"<card>([^<]+)</card>", inner)
    if "".join(f"<card>{match}</card>" for match in matches) != inner:
        return None
    boxes: list[dict[str, float]] = []
    for match in matches:
        parts = match.split(",")
        if len(parts) != 4:
            return None
        try:
            x, y, width, height = (float(part.strip()) for part in parts)
        except ValueError:
            return None
        box = {"x": x, "y": y, "width": width, "height": height}
        if not valid_box(box):
            return None
        boxes.append(box)
    return boxes


def valid_box(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    if not all(
        isinstance(value.get(key), (int, float))
        and not isinstance(value.get(key), bool)
        for key in ("x", "y", "width", "height")
    ):
        return False
    x, y, width, height = (
        float(value["x"]),
        float(value["y"]),
        float(value["width"]),
        float(value["height"]),
    )
    return (
        x >= 0
        and y >= 0
        and width > 0
        and height > 0
        and x + width <= 1000
        and y + height <= 1000
    )


def box_metrics(
    predicted: list[dict[str, float]],
    target: list[dict[str, float]],
    threshold: float,
) -> tuple[int, int, int]:
    matches: list[tuple[float, int, int]] = []
    for predicted_index, predicted_box in enumerate(predicted):
        for target_index, target_box in enumerate(target):
            overlap = box_iou(predicted_box, target_box)
            if overlap >= threshold:
                matches.append((overlap, predicted_index, target_index))
    used_predicted: set[int] = set()
    used_target: set[int] = set()
    true_positive = 0
    for _, predicted_index, target_index in sorted(matches, reverse=True):
        if predicted_index in used_predicted or target_index in used_target:
            continue
        used_predicted.add(predicted_index)
        used_target.add(target_index)
        true_positive += 1
    return (
        true_positive,
        len(predicted) - true_positive,
        len(target) - true_positive,
    )


def box_iou(left: dict[str, float], right: dict[str, float]) -> float:
    intersection_width = max(
        0.0,
        min(left["x"] + left["width"], right["x"] + right["width"])
        - max(left["x"], right["x"]),
    )
    intersection_height = max(
        0.0,
        min(left["y"] + left["height"], right["y"] + right["height"])
        - max(left["y"], right["y"]),
    )
    intersection = intersection_width * intersection_height
    left_area = left["width"] * left["height"]
    right_area = right["width"] * right["height"]
    union = left_area + right_area - intersection
    return intersection / union if union else 0.0


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    config = load_json(resolve_from_repo(repo_root, args.config))
    if config.get("modelId") != MODEL_ID:
        raise ValueError(f"Pix2Struct baseline config must use {MODEL_ID}")
    if config.get("targetFormat") not in {"json", "compact-tags"}:
        raise ValueError("Pix2Struct targetFormat must be json or compact-tags")
    if args.output_directory:
        config["outputDirectory"] = args.output_directory
    if args.max_steps is not None and args.max_steps <= 0:
        raise ValueError("--max-steps must be positive")
    if not 0 < args.real_discovery_share < 1:
        raise ValueError("--real-discovery-share must be between zero and one")

    manifest, records_by_split, dataset_root = validate_dataset(repo_root, config)
    if any(
        record["task"] != "discover-products"
        for records in records_by_split.values()
        for record in records
    ):
        raise ValueError("Pix2Struct discovery control requires discovery-only records")
    selected_train = (
        mixed_real_discovery_limit(
            records_by_split["train"],
            args.max_train_records,
            real_share=args.real_discovery_share,
        )
        if args.max_train_records is not None
        else records_by_split["train"]
    )
    selected_validation = stratified_limit(
        records_by_split["validation"], args.max_validation_records
    )
    targets = [
        visual_target(record, config["targetFormat"])
        for record in selected_train + selected_validation
    ]
    summary = {
        "valid": True,
        "modelId": config["modelId"],
        "datasetSha256": manifest["sha256"],
        "records": {
            "train": len(selected_train),
            "validation": len(selected_validation),
        },
        "visualTargets": len(targets),
        "targetBoxes": sum(
            len(parse_compact_prediction(target) or [])
            if config["targetFormat"] == "compact-tags"
            else len(json.loads(target)["cardBoxes"])
            for target in targets
        ),
        "realDiscoveryShare": args.real_discovery_share,
        "imagesUsed": True,
        "domTextUsed": False,
        "targetFormat": config["targetFormat"],
    }
    print(json.dumps(summary, indent=2))
    if args.validate_only:
        return
    train(
        config,
        manifest,
        selected_train,
        selected_validation,
        dataset_root,
        args.allow_non_cuda,
        args.max_steps,
        args.real_discovery_share,
        args.initial_checkpoint,
    )


def train(
    config: dict[str, Any],
    manifest: dict[str, Any],
    train_records: list[dict[str, Any]],
    validation_records: list[dict[str, Any]],
    dataset_root: Path,
    allow_non_cuda: bool,
    max_steps: int | None,
    real_discovery_share: float,
    initial_checkpoint: str | None,
) -> None:
    try:
        import torch
        from PIL import Image
        from torch.utils.data import Dataset
        from transformers import (
            AutoProcessor,
            Pix2StructForConditionalGeneration,
            Seq2SeqTrainer,
            Seq2SeqTrainingArguments,
            set_seed,
        )
    except ImportError as error:
        raise RuntimeError(
            "Training dependencies are missing. Run `uv sync --project training`."
        ) from error

    if not torch.cuda.is_available() and not allow_non_cuda:
        raise RuntimeError("CUDA is required for Pix2Struct baseline training")

    class Records(Dataset):
        def __init__(self, values: list[dict[str, Any]]) -> None:
            self.values = values

        def __len__(self) -> int:
            return len(self.values)

        def __getitem__(self, index: int) -> dict[str, Any]:
            return self.values[index]

    token = os.environ.get("HF_TOKEN")
    model_source = initial_checkpoint or config["modelId"]
    if initial_checkpoint and not Path(initial_checkpoint).is_dir():
        raise RuntimeError(
            f"Initial Pix2Struct checkpoint does not exist: {initial_checkpoint}"
        )
    processor = AutoProcessor.from_pretrained(model_source, token=token)
    processor.image_processor.is_vqa = True
    dtype = (
        torch.bfloat16
        if config["training"]["bf16"] and torch.cuda.is_available()
        else torch.float32
    )
    model = Pix2StructForConditionalGeneration.from_pretrained(
        model_source, token=token, dtype=dtype
    )
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
            images=images,
            text=[
                visual_header(record["pageId"], config["targetFormat"])
                for record in batch
            ],
            max_patches=config["maxPatches"],
            return_tensors="pt",
        )
        model_inputs["flattened_patches"] = model_inputs[
            "flattened_patches"
        ].to(dtype=dtype)
        labels = processor.tokenizer(
            text_target=[
                visual_target(record, config["targetFormat"])
                for record in batch
            ],
            padding=True,
            truncation=True,
            max_length=config["maxOutputTokens"],
            return_tensors="pt",
        )["input_ids"]
        labels[labels == processor.tokenizer.pad_token_id] = -100
        model_inputs["labels"] = labels
        return model_inputs

    evaluation_records = stratified_limit(
        validation_records, config["evaluation"]["generationSamples"]
    )
    output_directory = Path(config["outputDirectory"])
    if not output_directory.is_absolute():
        output_directory = Path(__file__).resolve().parent.parent / output_directory

    def compute_metrics(eval_prediction: Any) -> dict[str, float]:
        predictions, _ = eval_prediction
        if isinstance(predictions, tuple):
            predictions = predictions[0]
        predictions = sanitize_token_ids(
            predictions,
            pad_token_id=processor.tokenizer.pad_token_id,
            vocabulary_size=len(processor.tokenizer),
        )
        decoded_predictions = processor.batch_decode(
            predictions, skip_special_tokens=True
        )
        valid = 0
        true_positive = 0
        false_positive = 0
        false_negative = 0
        samples = []
        for record, prediction in zip(
            evaluation_records, decoded_predictions, strict=True
        ):
            predicted_boxes = parse_visual_prediction(
                prediction, record["pageId"], config["targetFormat"]
            )
            target = visual_target(record, config["targetFormat"])
            target_boxes = (
                parse_compact_prediction(target)
                if config["targetFormat"] == "compact-tags"
                else json.loads(target)["cardBoxes"]
            )
            if target_boxes is None:
                raise RuntimeError("Generated an invalid Pix2Struct target")
            if predicted_boxes is not None:
                valid += 1
                matched = box_metrics(
                    predicted_boxes,
                    target_boxes,
                    config["evaluation"]["boxIouThreshold"],
                )
                true_positive += matched[0]
                false_positive += matched[1]
                false_negative += matched[2]
            else:
                false_negative += len(target_boxes)
            samples.append(
                {
                    "id": record["id"],
                    "siteId": record["siteId"],
                    "pageId": record["pageId"],
                    "prediction": prediction,
                    "target": target,
                    "validJson": predicted_boxes is not None,
                }
            )
        precision_denominator = true_positive + false_positive
        recall_denominator = true_positive + false_negative
        precision = (
            true_positive / precision_denominator
            if precision_denominator
            else 0.0
        )
        recall = (
            true_positive / recall_denominator if recall_denominator else 0.0
        )
        f1 = (
            2 * precision * recall / (precision + recall)
            if precision + recall
            else 0.0
        )
        output_directory.mkdir(parents=True, exist_ok=True)
        (output_directory / "evaluation-samples.jsonl").write_text(
            "".join(json.dumps(sample) + "\n" for sample in samples),
            encoding="utf-8",
        )
        count = max(1, len(samples))
        return {
            "json_valid": valid / count,
            "box_precision": precision,
            "box_recall": recall,
            "box_f1": f1,
        }

    set_seed(config["seed"])
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
        eval_strategy="no",
        save_strategy="no",
        predict_with_generate=True,
        generation_max_length=config["maxOutputTokens"],
        remove_unused_columns=False,
        report_to="none",
        seed=config["seed"],
        **({"max_steps": max_steps} if max_steps is not None else {}),
    )
    trainer = Seq2SeqTrainer(
        model=model,
        args=arguments,
        train_dataset=Records(train_records),
        eval_dataset=Records(evaluation_records),
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
                "targetContract": config["targetFormat"],
                "initialCheckpoint": initial_checkpoint,
                "imagesUsed": True,
                "domTextUsed": False,
                "realDiscoveryShare": real_discovery_share,
                "trainingRecords": len(train_records),
                "validationRecords": len(evaluation_records),
                "startedAtUnix": time.time(),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    trainer.train()
    trainer.save_model()
    processor.save_pretrained(output_directory)
    metrics = trainer.evaluate()
    (output_directory / "evaluation-summary.json").write_text(
        json.dumps(metrics, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
