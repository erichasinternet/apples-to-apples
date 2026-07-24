#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import time
from typing import Any

from train_t5gemma2 import (
    load_json,
    mixed_real_discovery_limit,
    resolve_from_repo,
    stratified_limit,
    validate_dataset,
)
from train_pix2struct import parse_observation


MODEL_ID = "microsoft/markuplm-base"
KNOWN_TAGS = {
    "a",
    "article",
    "aside",
    "body",
    "button",
    "div",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "header",
    "img",
    "input",
    "label",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "section",
    "select",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "textarea",
    "th",
    "thead",
    "tr",
    "ul",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the DOM/XPath MarkupLM discovery baseline."
    )
    parser.add_argument(
        "--config",
        default="training/markuplm-base/discovery-baseline.json",
    )
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--allow-non-cuda", action="store_true")
    parser.add_argument("--output-directory")
    parser.add_argument("--max-train-records", type=int)
    parser.add_argument("--max-validation-records", type=int)
    parser.add_argument("--max-steps", type=int)
    parser.add_argument("--real-discovery-share", type=float, default=0.5)
    return parser.parse_args()


def prepare_record(
    record: dict[str, Any],
    max_nodes: int,
    observation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    observation = observation or parse_observation(record["prompt"])
    target = json.loads(record["target"]) if record.get("target") else None
    selected = select_nodes(
        observation["nodes"],
        record["metadata"]["sourceRegion"],
        max_nodes,
    )
    target_ids = set(target["cardNodeIds"]) if target else set()
    selected_ids = {node["id"] for node in selected}
    missing = sorted(target_ids - selected_ids)
    node_map = {node["id"]: node for node in observation["nodes"]}
    sibling_indexes = build_sibling_indexes(observation["nodes"])
    return {
        "id": record["id"],
        "pageId": record["pageId"],
        "siteId": record["siteId"],
        "nodeIds": [node["id"] for node in selected],
        "selectedNodes": selected,
        "nodes": [node_text(node) for node in selected],
        "xpaths": [
            node_xpath(node, node_map, sibling_indexes) for node in selected
        ],
        "labels": [
            1 if node["id"] in target_ids else 0 for node in selected
        ],
        "targetIds": sorted(target_ids),
        "missingTargetIds": missing,
    }


def select_nodes(
    nodes: list[dict[str, Any]],
    region: dict[str, float],
    max_nodes: int,
) -> list[dict[str, Any]]:
    candidates = [
        node
        for node in nodes
        if plausible_root(node, region)
        and not contains_repeated_semantic_children(node, nodes)
    ]
    if len(candidates) <= max_nodes:
        return candidates
    index = {node["id"]: position for position, node in enumerate(nodes)}
    ranked = sorted(
        candidates,
        key=lambda node: (
            -node_score(node, candidates),
            index[node["id"]],
        ),
    )[:max_nodes]
    return sorted(ranked, key=lambda node: index[node["id"]])


def plausible_root(
    node: dict[str, Any], region: dict[str, float]
) -> bool:
    bounds = node["bounds"]
    center_y = bounds["y"] + bounds["height"] / 2
    return (
        center_y >= region["y"]
        and center_y < region["y"] + region["height"]
        and bounds["width"] >= 80
        and bounds["width"] <= region["width"] * 1.02
        and bounds["height"] >= 80
        and bounds["height"] <= region["height"] * 1.5
    )


def contains_repeated_semantic_children(
    node: dict[str, Any], nodes: list[dict[str, Any]]
) -> bool:
    node_map = {entry["id"]: entry for entry in nodes}
    repeated_parents: dict[str | None, int] = {}
    for candidate in nodes:
        if candidate["id"] == node["id"] or not is_descendant(
            candidate, node["id"], node_map
        ):
            continue
        tag = normalized_tag(candidate.get("tag", "div"))
        role = str(candidate.get("role", "")).lower()
        if tag not in {"article", "li"} and role != "listitem":
            continue
        bounds = candidate["bounds"]
        if bounds["width"] < 80 or bounds["height"] < 80:
            continue
        parent = candidate.get("parent")
        repeated_parents[parent] = repeated_parents.get(parent, 0) + 1
        if repeated_parents[parent] >= 2:
            return True
    return False


def is_descendant(
    node: dict[str, Any],
    ancestor_id: str,
    node_map: dict[str, dict[str, Any]],
) -> bool:
    parent_id = node.get("parent")
    while parent_id:
        if parent_id == ancestor_id:
            return True
        parent = node_map.get(parent_id)
        parent_id = parent.get("parent") if parent else None
    return False


def node_score(
    node: dict[str, Any], candidates: list[dict[str, Any]]
) -> float:
    tag = normalized_tag(node.get("tag", "div"))
    role = str(node.get("role", "")).lower()
    evidence = " ".join(node_evidence(node))
    semantic = (
        30 * int(role == "listitem")
        + 28 * int(tag == "li")
        + 24 * int(tag == "article")
        + 8 * int(role == "group")
    )
    evidence_score = (
        5 * int(bool(evidence))
        + 5 * int(bool(re.search(r"[$£€¥]\s*\d|\d+\s*¢", evidence)))
        + 4 * int(bool(re.search(r"\b(oz|lb|kg|g|ml|l|count|pack)\b", evidence, re.I)))
    )
    repeated = sum(
        1
        for other in candidates
        if other["id"] != node["id"]
        and normalized_tag(other.get("tag", "div")) == tag
        and str(other.get("role", "")).lower() == role
        and dimension_ratio(other["bounds"]["width"], node["bounds"]["width"]) >= 0.8
        and dimension_ratio(other["bounds"]["height"], node["bounds"]["height"]) >= 0.7
    )
    return semantic + evidence_score + min(12, repeated)


def node_text(node: dict[str, Any]) -> str:
    parts = [normalized_tag(node.get("tag", "div"))]
    if node.get("role"):
        parts.append(str(node["role"]))
    evidence = next(iter(node_evidence(node)), "")
    if evidence:
        parts.extend(normalize_text(evidence).split()[:12])
    bounds = node["bounds"]
    parts.extend(
        [
            size_bucket(bounds["width"]),
            size_bucket(bounds["height"]),
        ]
    )
    return " ".join(parts)


def node_evidence(node: dict[str, Any]) -> list[str]:
    attributes = node.get("attributes") or {}
    return [
        value
        for value in (
            node.get("name"),
            node.get("accessibleName"),
            node.get("text"),
            attributes.get("alt"),
            attributes.get("ariaLabel"),
        )
        if isinstance(value, str) and value.strip()
    ]


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9$£€¥¢]+", " ", value.lower())).strip()


def size_bucket(value: float) -> str:
    if value < 120:
        return "small"
    if value < 280:
        return "medium"
    if value < 600:
        return "large"
    return "wide"


def dimension_ratio(left: float, right: float) -> float:
    return min(left, right) / max(left, right)


def normalized_tag(value: str) -> str:
    tag = value.strip()
    return tag if tag in KNOWN_TAGS else "div"


def build_sibling_indexes(
    nodes: list[dict[str, Any]],
) -> dict[str, int]:
    counts: dict[tuple[str | None, str], int] = {}
    indexes: dict[str, int] = {}
    for node in nodes:
        key = (node.get("parent"), normalized_tag(node.get("tag", "div")))
        counts[key] = counts.get(key, 0) + 1
        indexes[node["id"]] = counts[key]
    return indexes


def node_xpath(
    node: dict[str, Any],
    node_map: dict[str, dict[str, Any]],
    sibling_indexes: dict[str, int],
) -> str:
    parts = []
    seen = set()
    current: dict[str, Any] | None = node
    while current and current["id"] not in seen:
        seen.add(current["id"])
        tag = normalized_tag(current.get("tag", "div"))
        parts.append(f"{tag}[{sibling_indexes.get(current['id'], 1)}]")
        parent_id = current.get("parent")
        current = node_map.get(parent_id) if parent_id else None
    return "/" + "/".join(reversed(parts[-50:]))


def score_predictions(
    predictions: list[tuple[dict[str, Any], dict[str, float]]],
    threshold: float,
) -> dict[str, float | int]:
    true_positive = false_positive = false_negative = 0
    negative_pages = correct_negative_pages = 0
    for record, probabilities in predictions:
        predicted = {
            node_id
            for node_id, probability in probabilities.items()
            if probability >= threshold
        }
        target = set(record["targetIds"])
        true_positive += len(predicted & target)
        false_positive += len(predicted - target)
        false_negative += len(target - predicted)
        if not target:
            negative_pages += 1
            correct_negative_pages += int(not predicted)
    precision_denominator = true_positive + false_positive
    recall_denominator = true_positive + false_negative
    precision = (
        true_positive / precision_denominator if precision_denominator else 0.0
    )
    recall = true_positive / recall_denominator if recall_denominator else 0.0
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision + recall
        else 0.0
    )
    return {
        "threshold": threshold,
        "truePositive": true_positive,
        "falsePositive": false_positive,
        "falseNegative": false_negative,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "negativePages": negative_pages,
        "negativePageAccuracy": (
            correct_negative_pages / negative_pages if negative_pages else 0.0
        ),
    }


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    config = load_json(resolve_from_repo(repo_root, args.config))
    if config.get("modelId") != MODEL_ID:
        raise ValueError(f"MarkupLM baseline config must use {MODEL_ID}")
    if args.output_directory:
        config["outputDirectory"] = args.output_directory
    if args.max_steps is not None and args.max_steps <= 0:
        raise ValueError("--max-steps must be positive")
    if not 0 < args.real_discovery_share < 1:
        raise ValueError("--real-discovery-share must be between zero and one")

    manifest, records_by_split, _ = validate_dataset(repo_root, config)
    if any(
        record["task"] != "discover-products"
        for records in records_by_split.values()
        for record in records
    ):
        raise ValueError("MarkupLM discovery control requires discovery-only records")
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
    prepared_train = [
        prepare_record(record, config["maxNodes"]) for record in selected_train
    ]
    prepared_validation = [
        prepare_record(record, config["maxNodes"])
        for record in selected_validation
    ]
    missing = [
        {
            "id": record["id"],
            "missingTargetIds": record["missingTargetIds"],
        }
        for record in prepared_train + prepared_validation
        if record["missingTargetIds"]
    ]
    summary = {
        "valid": not missing,
        "modelId": config["modelId"],
        "datasetSha256": manifest["sha256"],
        "records": {
            "train": len(prepared_train),
            "validation": len(prepared_validation),
        },
        "candidateNodes": sum(
            len(record["nodeIds"])
            for record in prepared_train + prepared_validation
        ),
        "positiveNodes": sum(
            sum(record["labels"])
            for record in prepared_train + prepared_validation
        ),
        "missingTargets": missing,
        "realDiscoveryShare": args.real_discovery_share,
        "imagesUsed": False,
        "xpathUsed": True,
    }
    print(json.dumps(summary, indent=2))
    if missing:
        raise ValueError("MarkupLM candidate selection dropped adjudicated roots")
    if args.validate_only:
        return
    train(
        config,
        manifest,
        prepared_train,
        prepared_validation,
        args.allow_non_cuda,
        args.max_steps,
        args.real_discovery_share,
    )


def train(
    config: dict[str, Any],
    manifest: dict[str, Any],
    train_records: list[dict[str, Any]],
    validation_records: list[dict[str, Any]],
    allow_non_cuda: bool,
    max_steps: int | None,
    real_discovery_share: float,
) -> None:
    try:
        import numpy as np
        import torch
        from torch.utils.data import Dataset
        from transformers import (
            AutoProcessor,
            MarkupLMForTokenClassification,
            Trainer,
            TrainingArguments,
            set_seed,
        )
    except ImportError as error:
        raise RuntimeError(
            "Training dependencies are missing. Run `uv sync --project training`."
        ) from error

    if not torch.cuda.is_available() and not allow_non_cuda:
        raise RuntimeError("CUDA is required for MarkupLM baseline training")

    class Records(Dataset):
        def __init__(self, values: list[dict[str, Any]]) -> None:
            self.values = values

        def __len__(self) -> int:
            return len(self.values)

        def __getitem__(self, index: int) -> dict[str, Any]:
            return self.values[index]

    token = os.environ.get("HF_TOKEN")
    processor = AutoProcessor.from_pretrained(config["modelId"], token=token)
    processor.parse_html = False
    dtype = (
        torch.bfloat16
        if config["training"]["bf16"] and torch.cuda.is_available()
        else torch.float32
    )
    model = MarkupLMForTokenClassification.from_pretrained(
        config["modelId"],
        token=token,
        num_labels=2,
        id2label={0: "NOT_CARD", 1: "CARD_ROOT"},
        label2id={"NOT_CARD": 0, "CARD_ROOT": 1},
        dtype=dtype,
    )
    model.config.use_cache = False

    def collate(batch: list[dict[str, Any]]) -> dict[str, Any]:
        return processor(
            nodes=[record["nodes"] for record in batch],
            xpaths=[record["xpaths"] for record in batch],
            node_labels=[record["labels"] for record in batch],
            padding="max_length",
            truncation=True,
            max_length=config["maxLength"],
            return_tensors="pt",
        )

    class WeightedTrainer(Trainer):
        def compute_loss(
            self,
            model: Any,
            inputs: dict[str, Any],
            return_outputs: bool = False,
            num_items_in_batch: Any = None,
        ) -> Any:
            labels = inputs.pop("labels")
            outputs = model(**inputs)
            weights = torch.tensor(
                [1.0, config["training"]["positiveClassWeight"]],
                device=outputs.logits.device,
                dtype=torch.float32,
            )
            loss = torch.nn.functional.cross_entropy(
                outputs.logits.float().view(-1, 2),
                labels.view(-1),
                weight=weights,
                ignore_index=-100,
            )
            return (loss, outputs) if return_outputs else loss

    def token_metrics(eval_prediction: Any) -> dict[str, float]:
        logits, labels = eval_prediction
        predictions = np.argmax(logits, axis=-1)
        mask = labels != -100
        predicted = predictions[mask]
        expected = labels[mask]
        true_positive = int(((predicted == 1) & (expected == 1)).sum())
        false_positive = int(((predicted == 1) & (expected == 0)).sum())
        false_negative = int(((predicted == 0) & (expected == 1)).sum())
        precision = (
            true_positive / (true_positive + false_positive)
            if true_positive + false_positive
            else 0.0
        )
        recall = (
            true_positive / (true_positive + false_negative)
            if true_positive + false_negative
            else 0.0
        )
        return {
            "precision": precision,
            "recall": recall,
            "f1": (
                2 * precision * recall / (precision + recall)
                if precision + recall
                else 0.0
            ),
        }

    output_directory = Path(config["outputDirectory"])
    if not output_directory.is_absolute():
        output_directory = Path(__file__).resolve().parent.parent / output_directory
    set_seed(config["seed"])
    arguments = TrainingArguments(
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
        bf16=config["training"]["bf16"] and torch.cuda.is_available(),
        eval_strategy="no",
        save_strategy="no",
        remove_unused_columns=False,
        report_to="none",
        seed=config["seed"],
        **({"max_steps": max_steps} if max_steps is not None else {}),
    )
    trainer = WeightedTrainer(
        model=model,
        args=arguments,
        train_dataset=Records(train_records),
        eval_dataset=Records(validation_records),
        data_collator=collate,
        processing_class=processor,
        compute_metrics=token_metrics,
    )
    output_directory.mkdir(parents=True, exist_ok=True)
    (output_directory / "run-provenance.json").write_text(
        json.dumps(
            {
                "config": config,
                "datasetSha256": manifest["sha256"],
                "targetContract": "binary-card-root-node-classification",
                "imagesUsed": False,
                "xpathUsed": True,
                "realDiscoveryShare": real_discovery_share,
                "trainingRecords": len(train_records),
                "validationRecords": len(validation_records),
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
    token_summary = trainer.evaluate()
    probabilities = predict_records(
        model, processor, validation_records, config["maxLength"], torch
    )
    threshold_scores = [
        score_predictions(probabilities, threshold)
        for threshold in config["evaluation"]["thresholds"]
    ]
    best = max(
        threshold_scores,
        key=lambda score: (
            score["f1"],
            score["negativePageAccuracy"],
            score["precision"],
            -abs(score["threshold"] - 0.5),
        ),
    )
    summary = {
        **token_summary,
        "nodeClassification": best,
        "thresholdCandidates": threshold_scores,
    }
    (output_directory / "evaluation-summary.json").write_text(
        json.dumps(summary, indent=2) + "\n",
        encoding="utf-8",
    )
    (output_directory / "decision-threshold.json").write_text(
        json.dumps({"threshold": best["threshold"]}, indent=2) + "\n",
        encoding="utf-8",
    )


def predict_records(
    model: Any,
    processor: Any,
    records: list[dict[str, Any]],
    max_length: int,
    torch: Any,
) -> list[tuple[dict[str, Any], dict[str, float]]]:
    model.eval()
    device = next(model.parameters()).device
    results = []
    for record in records:
        encoding = processor(
            nodes=record["nodes"],
            xpaths=record["xpaths"],
            padding="max_length",
            truncation=True,
            max_length=max_length,
            return_tensors="pt",
        )
        word_ids = encoding.word_ids(0)
        inputs = {key: value.to(device) for key, value in encoding.items()}
        with torch.inference_mode():
            logits = model(**inputs).logits[0].float()
        probabilities = torch.softmax(logits, dim=-1)[:, 1].cpu().tolist()
        node_probabilities: dict[str, float] = {}
        seen = set()
        for token_index, word_id in enumerate(word_ids):
            if word_id is None or word_id in seen or word_id >= len(record["nodeIds"]):
                continue
            seen.add(word_id)
            node_probabilities[record["nodeIds"][word_id]] = probabilities[token_index]
        results.append((record, node_probabilities))
    return results


if __name__ == "__main__":
    main()
