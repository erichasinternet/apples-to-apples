#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import struct
import time
from typing import Any


DEFAULT_MODEL_ID = "google/t5gemma-2-270m-270m"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run grounded T5Gemma 2 inference records."
    )
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--records", required=True)
    parser.add_argument("--adapter")
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID)
    parser.add_argument("--output", required=True)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--max-input-tokens", type=int, default=8192)
    parser.add_argument("--max-output-tokens", type=int, default=192)
    return parser.parse_args()


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def png_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        header = handle.read(24)
    if (
        len(header) != 24
        or header[:8] != b"\x89PNG\r\n\x1a\n"
        or header[12:16] != b"IHDR"
    ):
        raise ValueError(f"Not a PNG image: {path}")
    return struct.unpack(">II", header[16:24])


def validate_records(bundle: Path, records: list[dict[str, Any]]) -> None:
    ids: set[str] = set()
    for record in records:
        record_id = record.get("id")
        if not isinstance(record_id, str) or record_id in ids:
            raise ValueError(f"Missing or duplicate record id: {record_id}")
        ids.add(record_id)
        if record.get("task") not in {"discover-products", "extract-product"}:
            raise ValueError(f"{record_id}: invalid task")
        image_path = (bundle / record["imagePath"]).resolve()
        image_path.relative_to(bundle.resolve())
        width, height = png_dimensions(image_path)
        crop = record["imageCrop"]
        if (
            min(crop["x"], crop["y"]) < 0
            or min(crop["width"], crop["height"]) <= 0
            or crop["x"] + crop["width"] > width
            or crop["y"] + crop["height"] > height
        ):
            raise ValueError(
                f"{record_id}: crop {crop} exceeds {width}x{height} image"
            )
        if not record.get("prompt", "").startswith("<start_of_image>\n"):
            raise ValueError(f"{record_id}: invalid prompt")


def infer(args: argparse.Namespace) -> dict[str, Any]:
    try:
        import torch
        from PIL import Image
        from peft import PeftModel
        from transformers import AutoModelForSeq2SeqLM, AutoProcessor
    except ImportError as error:
        raise RuntimeError(
            "Inference dependencies are missing. Run `uv sync --project training`."
        ) from error

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for live-corpus inference.")
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN is required for T5Gemma 2 inference.")

    bundle = Path(args.bundle).resolve()
    records_path = (bundle / args.records).resolve()
    records_path.relative_to(bundle)
    records = load_jsonl(records_path)
    if not records:
        raise ValueError(f"No inference records: {records_path}")
    validate_records(bundle, records)

    started = time.monotonic()
    processor = AutoProcessor.from_pretrained(args.model_id, token=token)
    model = AutoModelForSeq2SeqLM.from_pretrained(
        args.model_id, token=token, dtype=torch.bfloat16
    )
    if args.adapter:
        adapter = Path(args.adapter)
        if not adapter.is_dir():
            raise ValueError(f"Adapter does not exist: {adapter}")
        model = PeftModel.from_pretrained(model, adapter)
    model.to("cuda")
    model.eval()
    model.config.use_cache = True

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
            text=[record["prompt"] for record in batch],
            images=[[image] for image in images],
            padding=True,
            truncation=True,
            max_length=args.max_input_tokens,
            return_tensors="pt",
        )
        inputs = {key: value.to("cuda") for key, value in inputs.items()}
        with torch.inference_mode():
            generated = model.generate(
                **inputs,
                max_new_tokens=args.max_output_tokens,
                do_sample=False,
            )
        decoded = processor.batch_decode(generated, skip_special_tokens=True)
        for record, prediction in zip(batch, decoded, strict=True):
            predictions.append(
                {
                    "id": record["id"],
                    "task": record["task"],
                    "captureId": record["captureId"],
                    "pageId": record["pageId"],
                    "siteId": record["siteId"],
                    "prediction": prediction,
                }
            )

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        "".join(json.dumps(prediction) + "\n" for prediction in predictions),
        encoding="utf-8",
    )
    return {
        "modelId": args.model_id,
        "adapter": args.adapter,
        "records": len(records),
        "elapsedSeconds": round(time.monotonic() - started, 2),
        "gpu": torch.cuda.get_device_name(0),
        "predictions": predictions,
    }


def main() -> None:
    print(json.dumps(infer(parse_args()), indent=2))


if __name__ == "__main__":
    main()
