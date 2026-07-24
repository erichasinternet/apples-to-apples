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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the text-only FLAN-T5 discovery control."
    )
    parser.add_argument(
        "--config",
        default="training/flan-t5-base/discovery-baseline.json",
    )
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--allow-non-cuda", action="store_true")
    parser.add_argument("--output-directory")
    parser.add_argument("--max-train-records", type=int)
    parser.add_argument("--max-validation-records", type=int)
    parser.add_argument("--max-steps", type=int)
    parser.add_argument("--real-discovery-share", type=float, default=0.5)
    return parser.parse_args()


def text_prompt(prompt: str) -> str:
    prefix = "<start_of_image>\n"
    if not prompt.startswith(prefix):
        raise ValueError("Expected a multimodal prompt beginning with <start_of_image>")
    return prompt[len(prefix) :]


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    config = load_json(resolve_from_repo(repo_root, args.config))
    if config.get("modelId") != "google/flan-t5-base":
        raise ValueError("FLAN baseline config must use google/flan-t5-base")
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
        raise ValueError("FLAN discovery control requires discovery-only records")
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
    summary = {
        "valid": True,
        "modelId": config["modelId"],
        "datasetSha256": manifest["sha256"],
        "records": {
            "train": len(selected_train),
            "validation": len(selected_validation),
        },
        "realDiscoveryShare": args.real_discovery_share,
        "imagesUsed": False,
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
) -> None:
    try:
        import torch
        from peft import LoraConfig, TaskType, get_peft_model
        from torch.utils.data import Dataset
        from transformers import (
            AutoModelForSeq2SeqLM,
            AutoTokenizer,
            Seq2SeqTrainer,
            Seq2SeqTrainingArguments,
            set_seed,
        )
    except ImportError as error:
        raise RuntimeError(
            "Training dependencies are missing. Run `uv sync --project training`."
        ) from error

    if not torch.cuda.is_available() and not allow_non_cuda:
        raise RuntimeError("CUDA is required for FLAN-T5 baseline training")

    class Records(Dataset):
        def __init__(self, values: list[dict[str, Any]]) -> None:
            self.values = values

        def __len__(self) -> int:
            return len(self.values)

        def __getitem__(self, index: int) -> dict[str, Any]:
            return self.values[index]

    token = os.environ.get("HF_TOKEN")
    tokenizer = AutoTokenizer.from_pretrained(config["modelId"], token=token)
    dtype = (
        torch.bfloat16
        if config["training"]["bf16"] and torch.cuda.is_available()
        else torch.float32
    )
    model = AutoModelForSeq2SeqLM.from_pretrained(
        config["modelId"], token=token, dtype=dtype
    )
    model = get_peft_model(
        model,
        LoraConfig(
            task_type=TaskType.SEQ_2_SEQ_LM,
            r=config["training"]["loraRank"],
            lora_alpha=config["training"]["loraAlpha"],
            lora_dropout=config["training"]["loraDropout"],
            target_modules=config["training"]["targetModules"],
        ),
    )
    if config["training"]["gradientCheckpointing"]:
        model.gradient_checkpointing_enable()
    model.config.use_cache = False

    def collate(batch: list[dict[str, Any]]) -> dict[str, Any]:
        inputs = tokenizer(
            [text_prompt(record["prompt"]) for record in batch],
            padding=True,
            truncation=True,
            max_length=config["maxInputTokens"],
            return_tensors="pt",
        )
        labels = tokenizer(
            text_target=[record["target"] for record in batch],
            padding=True,
            truncation=True,
            max_length=config["maxOutputTokens"],
            return_tensors="pt",
        )["input_ids"]
        labels[labels == tokenizer.pad_token_id] = -100
        inputs["labels"] = labels
        return inputs

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
            pad_token_id=tokenizer.pad_token_id,
            vocabulary_size=len(tokenizer),
        )
        decoded_predictions = tokenizer.batch_decode(
            predictions, skip_special_tokens=True
        )
        valid = 0
        exact = 0
        samples = []
        for record, prediction in zip(
            evaluation_records,
            decoded_predictions,
            strict=True,
        ):
            try:
                parsed_prediction = json.loads(prediction)
                valid += 1
            except json.JSONDecodeError:
                parsed_prediction = None
            target = record["target"]
            parsed_target = json.loads(target)
            matches = parsed_prediction == parsed_target
            exact += int(matches)
            samples.append(
                {
                    "id": record["id"],
                    "siteId": record["siteId"],
                    "pageId": record["pageId"],
                    "prediction": prediction,
                    "target": target,
                    "validJson": parsed_prediction is not None,
                    "prefixExact": matches,
                }
            )
        count = max(1, len(samples))
        output_directory.mkdir(parents=True, exist_ok=True)
        (output_directory / "evaluation-samples.jsonl").write_text(
            "".join(json.dumps(sample) + "\n" for sample in samples),
            encoding="utf-8",
        )
        return {
            "json_valid": valid / count,
            "json_prefix_exact": exact / count,
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
        processing_class=tokenizer,
        compute_metrics=compute_metrics,
    )
    output_directory.mkdir(parents=True, exist_ok=True)
    (output_directory / "run-provenance.json").write_text(
        json.dumps(
            {
                "config": config,
                "datasetSha256": manifest["sha256"],
                "imagesUsed": False,
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
    tokenizer.save_pretrained(output_directory)
    metrics = trainer.evaluate()
    (output_directory / "evaluation-summary.json").write_text(
        json.dumps(metrics, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
