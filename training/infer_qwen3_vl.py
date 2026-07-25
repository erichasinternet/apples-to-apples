#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import time
from typing import Any

from infer_t5gemma2 import load_jsonl, validate_records


MODEL_ID = "Qwen/Qwen3-VL-2B-Instruct"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a zero-shot Qwen3-VL grounded extraction baseline."
    )
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--records", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-output-tokens", type=int, default=384)
    return parser.parse_args()


def infer(args: argparse.Namespace) -> dict[str, Any]:
    try:
        import torch
        from PIL import Image
        from transformers import AutoModelForMultimodalLM, AutoProcessor
    except ImportError as error:
        raise RuntimeError("Qwen3-VL inference dependencies are missing.") from error

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for Qwen3-VL inference.")
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN is required for Qwen3-VL inference.")

    bundle = Path(args.bundle).resolve()
    records_path = (bundle / args.records).resolve()
    records_path.relative_to(bundle)
    records = load_jsonl(records_path)
    if not records:
        raise ValueError(f"No inference records: {records_path}")
    validate_records(bundle, records)

    started = time.monotonic()
    processor = AutoProcessor.from_pretrained(MODEL_ID, token=token)
    model = AutoModelForMultimodalLM.from_pretrained(
        MODEL_ID,
        token=token,
        dtype=torch.bfloat16,
        attn_implementation="sdpa",
    )
    model.to("cuda")
    model.eval()

    predictions: list[dict[str, Any]] = []
    for record in records:
        crop = record["imageCrop"]
        with Image.open(bundle / record["imagePath"]) as source_image:
            image = source_image.convert("RGB").crop(
                (
                    crop["x"],
                    crop["y"],
                    crop["x"] + crop["width"],
                    crop["y"] + crop["height"],
                )
            )
        prompt = record["prompt"].removeprefix("<start_of_image>\n")
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": prompt},
                ],
            }
        ]
        inputs = processor.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_dict=True,
            return_tensors="pt",
        ).to(model.device)
        with torch.inference_mode():
            generated = model.generate(
                **inputs,
                max_new_tokens=args.max_output_tokens,
                do_sample=False,
            )
        input_length = inputs["input_ids"].shape[-1]
        prediction = processor.batch_decode(
            generated[:, input_length:],
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
        "records": len(records),
        "elapsedSeconds": round(time.monotonic() - started, 2),
        "gpu": torch.cuda.get_device_name(0),
        "predictions": predictions,
    }


def main() -> None:
    print(json.dumps(infer(parse_args()), indent=2))


if __name__ == "__main__":
    main()
