#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import time
from typing import Any

from infer_t5gemma2 import load_jsonl
from train_flan_t5 import text_prompt


MODEL_ID = "google/flan-t5-base"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the text-only FLAN-T5 discovery control."
    )
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--records", required=True)
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--max-input-tokens", type=int, default=4096)
    parser.add_argument("--max-output-tokens", type=int, default=192)
    return parser.parse_args()


def infer(args: argparse.Namespace) -> dict[str, Any]:
    try:
        import torch
        from peft import PeftModel
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
    except ImportError as error:
        raise RuntimeError(
            "Inference dependencies are missing. Run `uv sync --project training`."
        ) from error

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for FLAN-T5 inference")
    bundle = Path(args.bundle).resolve()
    records_path = (bundle / args.records).resolve()
    records_path.relative_to(bundle)
    records = load_jsonl(records_path)
    if not records:
        raise ValueError(f"No inference records: {records_path}")
    if any(record.get("task") != "discover-products" for record in records):
        raise ValueError("FLAN-T5 control supports discovery records only")

    token = os.environ.get("HF_TOKEN")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, token=token)
    model = AutoModelForSeq2SeqLM.from_pretrained(
        MODEL_ID, token=token, dtype=torch.bfloat16
    )
    model = PeftModel.from_pretrained(model, args.adapter)
    model.to("cuda")
    model.eval()
    model.config.use_cache = True

    started = time.monotonic()
    predictions: list[dict[str, Any]] = []
    for offset in range(0, len(records), args.batch_size):
        batch = records[offset : offset + args.batch_size]
        inputs = tokenizer(
            [text_prompt(record["prompt"]) for record in batch],
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
        decoded = tokenizer.batch_decode(generated, skip_special_tokens=True)
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
        "modelId": MODEL_ID,
        "adapter": args.adapter,
        "records": len(predictions),
        "elapsedSeconds": round(time.monotonic() - started, 2),
        "gpu": torch.cuda.get_device_name(0),
    }


if __name__ == "__main__":
    print(json.dumps(infer(parse_args()), indent=2))
