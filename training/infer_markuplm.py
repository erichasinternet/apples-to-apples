#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import time
from typing import Any

from infer_t5gemma2 import load_jsonl
from train_markuplm import prepare_record
from train_pix2struct import parse_observation


SIBLING_COMPLETION_MIN_SCORE = 0.3


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the DOM/XPath MarkupLM discovery baseline."
    )
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--records", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-nodes", type=int, default=64)
    parser.add_argument("--max-length", type=int, default=512)
    return parser.parse_args()


def infer(args: argparse.Namespace) -> dict[str, Any]:
    try:
        import torch
        from transformers import AutoProcessor, MarkupLMForTokenClassification
    except ImportError as error:
        raise RuntimeError(
            "Inference dependencies are missing. Run `uv sync --project training`."
        ) from error
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for MarkupLM inference")

    bundle = Path(args.bundle).resolve()
    records_path = (bundle / args.records).resolve()
    records_path.relative_to(bundle)
    records = load_jsonl(records_path)
    if not records:
        raise ValueError(f"No inference records: {records_path}")
    checkpoint = Path(args.checkpoint)
    threshold = json.loads(
        (checkpoint / "decision-threshold.json").read_text(encoding="utf-8")
    )["threshold"]
    processor = AutoProcessor.from_pretrained(checkpoint)
    processor.parse_html = False
    model = MarkupLMForTokenClassification.from_pretrained(
        checkpoint, dtype=torch.bfloat16
    )
    model.to("cuda")
    model.eval()
    observations = load_page_observations(bundle)

    started = time.monotonic()
    predictions = []
    for record in records:
        observation = observations.get(record["pageId"]) or parse_observation(
            record["prompt"]
        )
        prepared = prepare_record(record, args.max_nodes, observation)
        encoding = processor(
            nodes=prepared["nodes"],
            xpaths=prepared["xpaths"],
            padding="max_length",
            truncation=True,
            max_length=args.max_length,
            return_tensors="pt",
        )
        word_ids = encoding.word_ids(0)
        inputs = {key: value.to("cuda") for key, value in encoding.items()}
        with torch.inference_mode():
            logits = model(**inputs).logits[0].float()
        probabilities = torch.softmax(logits, dim=-1)[:, 1].cpu().tolist()
        node_scores = {}
        seen = set()
        for token_index, word_id in enumerate(word_ids):
            if (
                word_id is None
                or word_id in seen
                or word_id >= len(prepared["nodeIds"])
            ):
                continue
            seen.add(word_id)
            node_id = prepared["nodeIds"][word_id]
            probability = probabilities[token_index]
            node_scores[node_id] = probability
        card_node_ids = decode_card_node_ids(
            prepared,
            observation,
            record["metadata"]["sourceRegion"],
            node_scores,
            threshold,
        )
        predictions.append(
            {
                "id": record["id"],
                "task": record["task"],
                "captureId": record["captureId"],
                "pageId": record["pageId"],
                "siteId": record["siteId"],
                "prediction": json.dumps(
                    {
                        "version": 1,
                        "pageId": record["pageId"],
                        "cardNodeIds": card_node_ids,
                    },
                    separators=(",", ":"),
                ),
                "threshold": threshold,
                "nodeScores": node_scores,
            }
        )

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        "".join(json.dumps(prediction) + "\n" for prediction in predictions),
        encoding="utf-8",
    )
    return {
        "modelId": "microsoft/markuplm-base",
        "checkpoint": str(checkpoint),
        "threshold": threshold,
        "records": len(predictions),
        "elapsedSeconds": round(time.monotonic() - started, 2),
        "gpu": torch.cuda.get_device_name(0),
    }


def decode_card_node_ids(
    prepared: dict[str, Any],
    observation: dict[str, Any],
    region: dict[str, float],
    node_scores: dict[str, float],
    threshold: float,
) -> list[str]:
    selected = prepared["selectedNodes"]
    node_map = {node["id"]: node for node in observation["nodes"]}
    children: dict[str | None, list[str]] = {}
    for node in observation["nodes"]:
        children.setdefault(node.get("parent"), []).append(node["id"])

    eligible = {
        node["id"]
        for node in selected
        if horizontally_centered(node, region)
        and has_node_or_descendant_evidence(node["id"], node_map, children)
    }
    predicted = {
        node_id
        for node_id in eligible
        if node_scores.get(node_id, 0.0) >= threshold
    }
    by_parent: dict[str | None, list[str]] = {}
    for node_id in predicted:
        by_parent.setdefault(node_map[node_id].get("parent"), []).append(node_id)

    for parent_id, anchors in by_parent.items():
        if parent_id is None or len(anchors) < 2:
            continue
        anchor = node_map[anchors[0]]
        for node in selected:
            node_id = node["id"]
            if (
                node_id in eligible
                and node.get("parent") == parent_id
                and same_repeated_shape(node, anchor)
                and node_scores.get(node_id, 0.0)
                >= SIBLING_COMPLETION_MIN_SCORE
            ):
                predicted.add(node_id)
    return [
        node_id for node_id in prepared["nodeIds"] if node_id in predicted
    ]


def has_node_or_descendant_evidence(
    node_id: str,
    node_map: dict[str, dict[str, Any]],
    children: dict[str | None, list[str]],
) -> bool:
    stack = [node_id]
    while stack:
        current_id = stack.pop()
        current = node_map[current_id]
        attributes = current.get("attributes") or {}
        if any(
            isinstance(value, str) and value.strip()
            for value in (
                current.get("name"),
                current.get("text"),
                attributes.get("alt"),
                attributes.get("ariaLabel"),
            )
        ):
            return True
        stack.extend(children.get(current_id, []))
    return False


def same_repeated_shape(
    left: dict[str, Any], right: dict[str, Any]
) -> bool:
    if left.get("tag") != right.get("tag"):
        return False
    left_bounds = left["bounds"]
    right_bounds = right["bounds"]
    return (
        dimension_ratio(left_bounds["width"], right_bounds["width"]) >= 0.8
        and dimension_ratio(left_bounds["height"], right_bounds["height"])
        >= 0.7
    )


def dimension_ratio(left: float, right: float) -> float:
    return min(left, right) / max(left, right)


def horizontally_centered(
    node: dict[str, Any], region: dict[str, float]
) -> bool:
    bounds = node["bounds"]
    center_x = bounds["x"] + bounds["width"] / 2
    return region["x"] <= center_x < region["x"] + region["width"]


def load_page_observations(bundle: Path) -> dict[str, dict[str, Any]]:
    manifest_path = bundle / "manifest.json"
    if not manifest_path.exists():
        return {}
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    observations = {}
    for page in manifest.get("pages", []):
        observation_path = (bundle / page["observationPath"]).resolve()
        observation_path.relative_to(bundle)
        raw = json.loads(observation_path.read_text(encoding="utf-8"))
        observations[raw["pageId"]] = {
            "pageId": raw["pageId"],
            "nodes": [
                {
                    "id": node["id"],
                    **(
                        {"parent": node["parentId"]}
                        if node.get("parentId")
                        else {}
                    ),
                    "tag": node.get("tag", "div"),
                    **({"role": node["role"]} if node.get("role") else {}),
                    **({"text": node["text"]} if node.get("text") else {}),
                    **(
                        {"name": node["accessibleName"]}
                        if node.get("accessibleName")
                        else {}
                    ),
                    "attributes": node.get("attributes") or {},
                    "bounds": node["bounds"],
                }
                for node in raw["nodes"]
            ],
        }
    return observations


if __name__ == "__main__":
    print(json.dumps(infer(parse_args()), indent=2))
