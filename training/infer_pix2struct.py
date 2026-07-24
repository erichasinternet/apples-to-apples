#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import time
from typing import Any

from infer_t5gemma2 import load_jsonl
from train_pix2struct import parse_compact_prediction, visual_header


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the screenshot-native Pix2Struct discovery baseline."
    )
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--records", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--max-patches", type=int, default=2048)
    parser.add_argument("--max-output-tokens", type=int, default=256)
    parser.add_argument(
        "--target-format",
        choices=("json", "compact-tags"),
        default="json",
    )
    return parser.parse_args()


def infer(args: argparse.Namespace) -> dict[str, Any]:
    try:
        import torch
        from PIL import Image
        from transformers import (
            AutoProcessor,
            Pix2StructForConditionalGeneration,
        )
    except ImportError as error:
        raise RuntimeError(
            "Inference dependencies are missing. Run `uv sync --project training`."
        ) from error

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for Pix2Struct inference")
    bundle = Path(args.bundle).resolve()
    records_path = (bundle / args.records).resolve()
    records_path.relative_to(bundle)
    records = load_jsonl(records_path)
    if not records:
        raise ValueError(f"No inference records: {records_path}")
    if any(record.get("task") != "discover-products" for record in records):
        raise ValueError("Pix2Struct control supports discovery records only")

    checkpoint = Path(args.checkpoint)
    processor = AutoProcessor.from_pretrained(checkpoint)
    processor.image_processor.is_vqa = True
    model = Pix2StructForConditionalGeneration.from_pretrained(
        checkpoint, dtype=torch.bfloat16
    )
    model.to("cuda")
    model.eval()
    model.config.use_cache = True

    started = time.monotonic()
    predictions: list[dict[str, Any]] = []
    for offset in range(0, len(records), args.batch_size):
        batch = records[offset : offset + args.batch_size]
        images = []
        for record in batch:
            crop = record["imageCrop"]
            with Image.open(bundle / record["imagePath"]) as image:
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
        inputs = processor(
            images=images,
            text=[
                visual_header(record["pageId"], args.target_format)
                for record in batch
            ],
            max_patches=args.max_patches,
            return_tensors="pt",
        )
        inputs = {
            key: value.to(
                device="cuda",
                dtype=(
                    model.dtype
                    if key == "flattened_patches"
                    else value.dtype
                ),
            )
            for key, value in inputs.items()
        }
        with torch.inference_mode():
            generated = model.generate(
                **inputs,
                max_new_tokens=args.max_output_tokens,
                do_sample=False,
            )
        decoded = processor.batch_decode(generated, skip_special_tokens=True)
        for record, prediction in zip(batch, decoded, strict=True):
            raw_prediction = prediction
            if args.target_format == "compact-tags":
                boxes = parse_compact_prediction(prediction)
                if boxes is not None:
                    prediction = json.dumps(
                        {
                            "version": 1,
                            "pageId": record["pageId"],
                            "cardBoxes": boxes,
                        },
                        separators=(",", ":"),
                    )
            predictions.append(
                {
                    "id": record["id"],
                    "task": record["task"],
                    "captureId": record["captureId"],
                    "pageId": record["pageId"],
                    "siteId": record["siteId"],
                    "prediction": prediction,
                    "rawPrediction": raw_prediction,
                }
            )

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        "".join(json.dumps(prediction) + "\n" for prediction in predictions),
        encoding="utf-8",
    )
    return {
        "modelId": "google/pix2struct-base",
        "checkpoint": str(checkpoint),
        "records": len(predictions),
        "elapsedSeconds": round(time.monotonic() - started, 2),
        "gpu": torch.cuda.get_device_name(0),
    }


if __name__ == "__main__":
    print(json.dumps(infer(parse_args()), indent=2))
