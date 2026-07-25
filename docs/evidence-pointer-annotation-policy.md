# Evidence-Pointer Annotation Policy

## Unit Of Review

A review covers every candidate product root in one immutable bounded page region.
The source observation and screenshot are identified by SHA-256. Review artifacts
are append-only; corrections create a new review ID.

Each product stores the exact seven-line evidence-pointer target accepted by the
runtime validator. Reviewers select candidate IDs, not prices, quantities, units,
or normalized values. The deterministic runtime derives and validates those facts.

## Independent Review

Two reviewers label the same source independently:

- Reviewers have distinct stable IDs.
- Preannotations and the other review remain hidden until submission.
- Each reviewer marks complete region coverage.
- Product roots, scope, title evidence, numeric candidates, and status are all
  selected independently.
- A model output or deterministic preannotation is a review aid, never a review.

The review validator rejects unknown nodes, unknown candidates, cross-card
evidence, incompatible statuses, invalid arithmetic inputs, duplicate cards,
source-hash mismatches, and incomplete expected-root coverage.

## Adjudication

A third person adjudicates after both independent reviews are immutable. The
adjudicator must:

- Cite exactly the two source review IDs.
- Resolve every root or field disagreement.
- Include no card that lacks dual independent review.
- Re-run the pointer and deterministic validators against the original source.

An adjudicated artifact is exportable only when all of these checks pass. Agreement
thresholds are cohort gates, not reasons to overwrite a valid disagreement.

## Agreement Metrics

Report before adjudication:

- Exact product-root set agreement and root precision, recall, and F1.
- Comparable-versus-abstain Cohen's kappa.
- Exact status agreement.
- Exact current-price candidate agreement.
- Exact package-quantity plus pack-count agreement.
- Exact resolved-dimension agreement.
- Exact full-target pointer agreement.

The development gate requires comparable kappa at least 0.90, exact price,
quantity, and dimension agreement at least 0.98, and full pointer agreement at
least 0.95. Undefined kappa is reported as `null`; a constant identical label set
is reported as 1.

## Separation Of Duties

Training and internal validation may use adjudicated development reviews.
Selection reviews cannot become training data. Final reviews remain sealed until
the model artifact and thresholds are frozen. Any evaluation source viewed while
changing prompts, parsers, candidates, data, thresholds, or code is retired from
final status.

Raw captures remain private. Public dataset releases contain only redistribution-
cleared derived artifacts and provenance metadata.

## Commands

Create separate immutable queues without model or peer labels:

```bash
bun run dataset:reviews:queue -- --run benchmark-data/live/<run> \
  --reviewer reviewer-a --cohort training \
  --output benchmark-data/review/<run>-reviewer-a-queue.json
```

Open one blinded queue in the local review workbench:

```bash
bun run dataset:reviews:serve -- \
  --queue benchmark-data/review/<queue>.json \
  --output benchmark-data/review/submissions/<reviewer>
```

The workbench binds to `127.0.0.1`, serves only queue-declared assets beneath
`benchmark-data`, exposes no model or peer labels, validates submissions against
the immutable observation and hashes, and refuses to overwrite an existing
review.

After a reviewer chooses a card root, list the deterministic numeric candidates:

```bash
bun run dataset:reviews:candidates -- observation.json n42
```

Score independent submissions and emit every unresolved field:

```bash
bun run dataset:reviews:score -- observation.json review-a.json review-b.json
```

Validate and compile a third-party adjudication into the corpus annotation used by
the training exporter:

```bash
bun run dataset:reviews:compile -- observation.json review-a.json review-b.json \
  adjudication.json annotation.json
```
