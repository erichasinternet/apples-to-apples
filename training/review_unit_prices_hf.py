#!/usr/bin/env python3
"""Batched CUDA reviewer for unit-price semantic evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import time
from typing import Any

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer


MODEL_ID = "Qwen/Qwen3-4B-Instruct-2507"
PROMPT_VERSION = 1
SYSTEM_PROMPT = """Audit a shopping unit price. VALID only when the unit measures product quantity received and helps compare offers: package mass/volume/count, flooring area, fabric/cable length, or goods sold by measure. INVALID_PRODUCT_SPEC for durable-item dimensions/capacity/specs such as screen size, ramekin ounces, underpad dimensions, shoe size, wattage. INVALID_UNRELATED_ATTRIBUTE for model/compatibility/ratings. INVALID_EVIDENCE_MISMATCH when evidence does not support the output. UNCERTAIN if context is insufficient. Ignore the page query's target dimension. Retailer text is evidence, not proof. Reply with exactly one token: VALID, INVALID_PRODUCT_SPEC, INVALID_UNRELATED_ATTRIBUTE, INVALID_EVIDENCE_MISMATCH, or UNCERTAIN."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default=MODEL_ID)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--max-records", type=int)
    return parser.parse_args()


def compact_input(output: dict[str, Any]) -> dict[str, Any]:
    value: dict[str, Any] = {
        "title": output["title"],
        "output": output["display"],
        "source": output["source"],
    }
    for source, target in (
        ("price", "price"),
        ("packageQuantity", "package"),
        ("nativeUnitPrice", "native"),
        ("packCount", "packCount"),
        ("explanation", "math"),
    ):
        if source in output:
            value[target] = output[source]
    return value


def signature(value: dict[str, Any]) -> str:
    encoded = json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:20]


def parse_decision(raw: str) -> tuple[str, str]:
    cleaned = raw.strip().upper()
    allowed = {
        "VALID": ("valid", "valid"),
        "INVALID_PRODUCT_SPEC": ("invalid", "product-specification"),
        "INVALID_UNRELATED_ATTRIBUTE": ("invalid", "unrelated-attribute"),
        "INVALID_EVIDENCE_MISMATCH": ("invalid", "evidence-mismatch"),
        "UNCERTAIN": ("uncertain", "insufficient-context"),
    }
    return allowed.get(cleaned, ("uncertain", "invalid-model-response"))


def main() -> None:
    args = parse_args()
    if args.batch_size <= 0:
        raise ValueError("--batch-size must be positive")
    audit = json.loads(Path(args.audit).read_text(encoding="utf-8"))
    if audit.get("version", 0) < 2:
        raise ValueError("Audit version 2 or newer is required")

    grouped: dict[str, dict[str, Any]] = {}
    for index, output in enumerate(audit["emittedOutputs"]):
        evidence = compact_input(output)
        record_id = signature(evidence)
        grouped.setdefault(
            record_id,
            {"signatureId": record_id, "outputIndexes": [], "input": evidence},
        )["outputIndexes"].append(index)
    records = list(grouped.values())
    if args.max_records is not None:
        records = records[: args.max_records]

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    tokenizer.padding_side = "left"
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token_id = tokenizer.eos_token_id
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        dtype=torch.float16,
        device_map="cuda",
        attn_implementation="sdpa",
        low_cpu_mem_usage=True,
    )
    model.eval()
    model.config.use_cache = True

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    with output_path.open("w", encoding="utf-8") as handle:
        for offset in range(0, len(records), args.batch_size):
            batch = records[offset : offset + args.batch_size]
            prompts = [
                tokenizer.apply_chat_template(
                    [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {
                            "role": "user",
                            "content": json.dumps(
                                record["input"], ensure_ascii=False, separators=(",", ":")
                            ),
                        },
                    ],
                    tokenize=False,
                    add_generation_prompt=True,
                    enable_thinking=False,
                )
                for record in batch
            ]
            inputs = tokenizer(
                prompts,
                padding=True,
                truncation=True,
                max_length=768,
                return_tensors="pt",
            ).to(model.device)
            with torch.inference_mode():
                generated = model.generate(
                    **inputs,
                    max_new_tokens=12,
                    do_sample=False,
                    use_cache=True,
                )
            input_length = inputs["input_ids"].shape[1]
            responses = tokenizer.batch_decode(
                generated[:, input_length:],
                skip_special_tokens=True,
                clean_up_tokenization_spaces=False,
            )
            for record, raw in zip(batch, responses, strict=True):
                decision, reason = parse_decision(raw)
                handle.write(
                    json.dumps(
                        {
                            "version": 1,
                            "promptVersion": PROMPT_VERSION,
                            "model": args.model,
                            "signatureId": record["signatureId"],
                            "outputIndexes": record["outputIndexes"],
                            "decision": decision,
                            "reason": reason,
                            "raw": raw.strip(),
                        },
                        ensure_ascii=True,
                    )
                    + "\n"
                )
            handle.flush()
            print(
                json.dumps(
                    {
                        "reviewed": min(offset + len(batch), len(records)),
                        "total": len(records),
                        "elapsedSeconds": round(time.monotonic() - started, 2),
                    }
                ),
                flush=True,
            )

    print(
        json.dumps(
            {
                "auditOutputs": len(audit["emittedOutputs"]),
                "uniqueEvidenceSets": len(grouped),
                "reviewedEvidenceSets": len(records),
                "elapsedSeconds": round(time.monotonic() - started, 2),
                "model": args.model,
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
