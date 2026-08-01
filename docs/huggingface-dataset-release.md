# Hugging Face Dataset Release

## Public Boundary

The public dataset, **Unit Price Evidence: Synthetic**, is the generated
synthetic evidence-pointer corpus only. It includes rendered synthetic page
images, site-independent observations, candidate catalogs, and evidence-pointer
targets. The public name is model-neutral because the records can train or
evaluate any compatible grounded extraction system.

The release excludes:

- raw or derived live-retailer HTML and screenshots;
- silver and preannotation records;
- review queues and reviewer identities;
- selection and final evaluation data;
- account, address, cookie, query-string, or browsing-history data; and
- application secrets and model credentials.

The dataset artifacts are licensed under CDLA-Permissive-2.0. This dataset-only
license does not change the application source repository's MIT License.

## Build

Generate and validate the release with Bun:

```bash
bun run dataset:huggingface:prepare
bun run dataset:huggingface:validate
```

The default output is:

```text
artifacts/huggingface/unit-price-evidence-synthetic-v0.1.0/
```

The builder performs an atomic release and fails on:

- any non-synthetic domain, page ID, capture ID, or asset path;
- train and validation domain leakage;
- duplicate record IDs or inconsistent record counts;
- missing, unknown, or hash-mismatched image assets;
- URLs, email addresses, API credentials, cookies, or private keys;
- a source-record hash mismatch; or
- an invalid source dataset type or target format.

The package contains a Hugging Face `README.md`, dataset-only `LICENSE.md`,
JSONL train and validation splits, rendered images, an asset manifest, and a
release manifest with content hashes.

## Pre-Publication Review

Before uploading a version:

1. Run the source pointer audit and release build:

   ```bash
   bun run training:synthetic:audit
   bun run dataset:huggingface:prepare
   ```

2. Review `README.md`, `release-manifest.json`, and at least 50 randomly sampled
   records and images.
3. Confirm that the Hugging Face Dataset Viewer recognizes the `image` column
   and both data splits in a private repository.
4. Record the immutable release commit and package manifest hash.
5. Make the dataset public only after the private upload passes the viewer and
   download smoke tests.

The public card must continue to state that synthetic results do not establish
live-site accuracy. Gold real-site data remains a separate future release gated
on independent review, adjudication, leakage checks, and rights clearance.

## Upload

Create a private Hugging Face dataset repository first, then upload the generated
folder with the official Hugging Face CLI:

```bash
hf upload <account>/unit-price-evidence-synthetic \
  --repo-type dataset \
  artifacts/huggingface/unit-price-evidence-synthetic-v0.1.0
```

Do not place access tokens in shell history, source files, dataset cards, or
release manifests.
