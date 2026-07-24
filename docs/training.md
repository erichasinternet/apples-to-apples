# T5Gemma 2 Training

## Objective

Train a site-independent model to perform two evidence-grounded tasks:

1. Discover all product-card root node IDs in a bounded page region.
2. Extract visible product facts and their evidence node IDs from one card.

The model never calculates normalized unit prices. Existing deterministic code validates
the cited evidence, converts compatible units, computes unit price, and decides whether a
result is safe to display.

## Data Requirements

The pilot gate is:

- 24 training domains and 6 domain-disjoint validation domains.
- 120 unique pages.
- 1,500 labeled products.
- At least 300 explicit abstention examples.
- Complete main-region coverage.
- Two reviewers and an adjudicated label for every exported page.
- An aligned `annotation.png` for every observation.

The internal split is fixed in
[`training-splits.json`](../benchmarks/live-sites/training-splits.json). Selection and
held-out benchmark domains are sealed and cannot be exported for training.

These counts are a pilot threshold, not evidence that the production goal has been met.
Run learning-curve experiments at roughly 500, 1,500, 3,000, 10,000, and 20,000 products.
Stop increasing the dataset only when domain-held-out error has plateaued and the
promotion gates in [learned-extraction.md](learned-extraction.md) pass.

## Local Preparation

Audit one or more capture runs:

```bash
bun run training:readiness -- benchmark-data/live/<run-id> [...]
```

The command exits unsuccessfully until every pilot target is met. Its `blockers` object
groups missing reviews, incomplete coverage, invalid labels, and missing artifacts.

Build the immutable training dataset:

```bash
bun run training:prepare -- benchmark-data/live/<run-id> [...] \
  --output benchmark-data/training/t5gemma2
bun run training:validate
```

Preparation creates domain-separated `train.jsonl` and `validation.jsonl`, aligned image
assets, and a manifest containing source runs and SHA-256 hashes. The default is strict:
rejected labels stop export. `--allow-incomplete` and `--allow-single-review` are only for
non-release debugging and must not be used for benchmark claims.

## GPU Training

The repository uses Bun for its TypeScript tooling and `uv` for the isolated Python ML
environment:

```bash
bun run training:sync
HF_TOKEN=<token> bun run training:run
```

Before running:

1. Accept the Gemma usage terms for
   [`google/t5gemma-2-270m-270m`](https://huggingface.co/google/t5gemma-2-270m-270m).
2. Use a CUDA GPU host with enough memory for the configured LoRA run.
3. Transfer the repository and generated dataset without changing their relative paths.
4. Run `bun run training:validate` on the host before downloading model weights.

The checked-in configuration uses the 270M-270M T5Gemma 2 checkpoint, LoRA, BF16,
gradient checkpointing, and an effective batch size of 16. The checkpoint is approximately
0.8B total parameters because the name describes its encoder and decoder component sizes.
The default command deliberately rejects a non-CUDA host. `--allow-non-cuda` exists only
for tiny pipeline debugging.

## Evaluation

Training-time JSON validity and exact match are diagnostics, not release metrics. Evaluate
each checkpoint through the existing evidence validator and report:

- Product discovery precision and recall.
- Exact accuracy for price, native unit price, quantity, multipack, and title.
- Comparable-product normalized accuracy.
- Abstention precision and recall.
- Incorrect displayed unit-price rate.
- Results by unseen domain, vertical, dimension, and data source.

Do not tune on selection or held-out domains. Use selection once to choose the final
candidate and run the held-out benchmark once for the final claim.

## Current Constraint

Dataset preparation and validation run locally on macOS. The configured training run does
not: this machine has no CUDA device. The practical next step is annotation and
adjudication, because unreviewed captures are intentionally excluded from training.
