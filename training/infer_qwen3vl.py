#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import struct
import time
from typing import Any


MODEL_ID = "Qwen/Qwen3-VL-2B-Instruct"
REVIEW_INSTRUCTIONS = """You are an independent shopping-page visual reviewer.
Identify every visible product-card rectangle in the screenshot.
A product card is one repeated result tile containing a product image or title and purchase information.
Exclude headers, filters, grids, rows, footers, advertisements, buttons, prices, and card fragments.
Return tight outer rectangles, not rectangles around content inside a card.
Coordinates are integers normalized from 0 to 1000 relative to the screenshot width and height.
Return an empty cardBoxes array when the screenshot has no product cards.
Return exactly one JSON object and no Markdown:
{"version":1,"pageId":"...","cardBoxes":[{"x":0,"y":0,"width":0,"height":0}]}
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run independent Qwen3-VL product-card review."
    )
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--records", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-records", type=int)
    parser.add_argument("--max-output-tokens", type=int, default=384)
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
        if record.get("task") != "discover-products":
            raise ValueError(f"{record_id}: reviewer only supports discovery")
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
        from transformers import AutoModelForImageTextToText, AutoProcessor
    except ImportError as error:
        raise RuntimeError(
            "Reviewer dependencies are missing. Run `uv sync --project training`."
        ) from error

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for Qwen3-VL review.")
    if args.max_records is not None and args.max_records <= 0:
        raise ValueError("--max-records must be positive")

    bundle = Path(args.bundle).resolve()
    records_path = (bundle / args.records).resolve()
    records_path.relative_to(bundle)
    records = load_jsonl(records_path)
    if args.max_records is not None:
        records = records[: args.max_records]
    if not records:
        raise ValueError(f"No inference records: {records_path}")
    validate_records(bundle, records)

    started = time.monotonic()
    processor = AutoProcessor.from_pretrained(
        MODEL_ID,
        min_pixels=256 * 28 * 28,
        max_pixels=512 * 28 * 28,
    )
    model = AutoModelForImageTextToText.from_pretrained(
        MODEL_ID,
        dtype=torch.float16,
        device_map="auto",
        low_cpu_mem_usage=True,
    )
    model.eval()
    model.config.use_cache = True

    predictions: list[dict[str, Any]] = []
    for record in records:
        crop = record["imageCrop"]
        with Image.open(bundle / record["imagePath"]) as source:
            image = source.convert("RGB").crop(
                (
                    crop["x"],
                    crop["y"],
                    crop["x"] + crop["width"],
                    crop["y"] + crop["height"],
                )
            )
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {
                        "type": "text",
                        "text": (
                            f"{REVIEW_INSTRUCTIONS}\n"
                            f"Use pageId {json.dumps(record['pageId'])}."
                        ),
                    },
                ],
            }
        ]
        inputs = processor.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_dict=True,
            return_tensors="pt",
        )
        inputs = inputs.to(model.device)
        with torch.inference_mode():
            generated = model.generate(
                **inputs,
                max_new_tokens=args.max_output_tokens,
                do_sample=False,
            )
        trimmed = generated[:, inputs.input_ids.shape[1] :]
        prediction = processor.batch_decode(
            trimmed,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )[0]
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
        "modelId": MODEL_ID,
        "reviewPromptVersion": 2,
        "records": len(records),
        "elapsedSeconds": round(time.monotonic() - started, 2),
        "gpu": torch.cuda.get_device_name(0),
        "predictions": predictions,
    }


def main() -> None:
    print(json.dumps(infer(parse_args()), indent=2))


if __name__ == "__main__":
    main()
