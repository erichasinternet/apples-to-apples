# Evidence-Pointer Annotation Policy

## Unit Of Review

A review covers every candidate product root in one immutable bounded page region.
The source observation and screenshot are identified by SHA-256. Review artifacts
are append-only; corrections create a new review ID.

Each product stores the exact seven-line evidence-pointer target accepted by the
runtime validator. Reviewers select candidate IDs, not prices, quantities, units,
or normalized values. The deterministic runtime derives and validates those facts.
The queue freezes the collector's exact candidate card-root IDs. The workbench
offers only those roots, scopes field candidates to the selected card, and rejects
submissions that omit a candidate root or introduce an ancestor, descendant, or
other node as a card. This is what makes complete coverage and cross-card rejection
enforceable rather than reviewer convention.

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

When a qualification screen contains both accepted and rejected captures, freeze
only exact accepted pages without rewriting the source run:

```bash
bun run dataset:reviews:queue -- --run benchmark-data/live/<run> \
  --reviewer reviewer-a --cohort training \
  --pages accepted-page-a,accepted-page-b \
  --output benchmark-data/review/<run>-reviewer-a-queue.json
```

Merge multiple single-run queues for one reviewer into a deterministic campaign:

```bash
bun run dataset:reviews:campaign -- \
  --output benchmark-data/review/<campaign>.json \
  benchmark-data/review/<run-1>-reviewer-a-queue.json \
  benchmark-data/review/<run-2>-reviewer-a-queue.json
```

Campaign merging rejects mixed reviewers, mixed cohorts, labels, duplicate pages,
duplicate review IDs, invalid source hashes, and queues without frozen candidate
card roots. Paths are rebased without changing source evidence.

Partition a large paired campaign into deterministic matching assignments:

```bash
bun run dataset:reviews:batches -- \
  --queue-a benchmark-data/review/<campaign>-reviewer-a.json \
  --queue-b benchmark-data/review/<campaign>-reviewer-b.json \
  --output-dir benchmark-data/review/<campaign>-batches \
  --manifest benchmarks/reviews/<campaign>-review-batches.json \
  --campaign-id <campaign> --pages-per-batch 10
```

Batching fails unless the two source queues have distinct reviewer identities
and identical page evidence, source hashes, and frozen card roots. It preserves
the original review IDs, rebases evidence paths, records hashes for every batch
queue, and gives both reviewers the same page assignments. Reviewers may work on
different batches in parallel while writing to their own shared submission
directory; the original full campaigns remain the source of truth for progress
auditing and adjudication.

Open one blinded queue or campaign in the local review workbench:

```bash
bun run dataset:reviews:serve -- \
  --queue benchmark-data/review/<queue>.json \
  --output benchmark-data/review/submissions/<reviewer>
```

The workbench binds to `127.0.0.1`, serves only queue-declared assets beneath
`benchmark-data`, exposes no model or peer labels, validates submissions against
the immutable observation, hashes, and complete frozen card-root set, and refuses
to overwrite an existing review. Reviewers can select any frozen card root
directly, and the workbench advances to the next unreviewed root after each label.
Partial page decisions are retained in browser-local storage under a key bound to
the queue, review ID, and observation hash; they are removed after immutable
submission and never sent to another reviewer. The editor requires an explicit
status and a structurally valid comparable or abstention pointer before recording
each card. Submission remains disabled until every frozen root has a card-scoped
decision.

Audit two submission directories as a complete campaign. Missing reviews are
reported as pending progress; malformed, duplicate, unexpected, identity-drifted,
hash-drifted, or incomplete submissions fail the audit:

```bash
bun run dataset:reviews:audit -- \
  --queue-a benchmark-data/review/<campaign>-reviewer-a.json \
  --queue-b benchmark-data/review/<campaign>-reviewer-b.json \
  --submissions-a benchmark-data/review/submissions/reviewer-a \
  --submissions-b benchmark-data/review/submissions/reviewer-b \
  --output benchmark-data/review/<campaign>-status.json
```

The report pairs reviews by immutable page evidence, computes campaign-level
agreement weighted by aligned card count, lists every unresolved field, and marks
`readyForAdjudication` only after every page has two valid independent reviews.

Build the third-party queue only after the audit is fully paired:

```bash
bun run dataset:reviews:adjudication-queue -- \
  --queue-a benchmark-data/review/<campaign>-reviewer-a.json \
  --queue-b benchmark-data/review/<campaign>-reviewer-b.json \
  --submissions-a benchmark-data/review/submissions/reviewer-a \
  --submissions-b benchmark-data/review/submissions/reviewer-b \
  --adjudicator reviewer-c \
  --output benchmark-data/review/<campaign>-adjudication.json
```

The builder refuses missing or invalid independent reviews and an adjudicator ID
that matches either reviewer. The adjudication queue contains the two immutable
source decisions and their field-level disagreements; these labels never appear
in either blinded reviewer queue.

Serve the adjudication queue through the same workbench:

```bash
bun run dataset:reviews:serve -- \
  --queue benchmark-data/review/<campaign>-adjudication.json \
  --output benchmark-data/review/submissions/reviewer-c
```

The workbench marks disputed roots, shows both decisions, allows either exact
pointer to populate the card-scoped editor, and still requires a third-party
decision for every frozen root. The server rejects reused identities, changed
source review IDs, invalid pointers, incomplete coverage, and adjudications
timestamped before either independent review.

Compile a complete adjudication campaign atomically:

```bash
bun run dataset:reviews:adjudication-compile -- \
  --queue benchmark-data/review/<campaign>-adjudication.json \
  --submissions benchmark-data/review/submissions/reviewer-c \
  --output benchmark-data/review/adjudicated/<campaign>
```

Compilation validates every artifact before writing, creates no partial output,
and emits immutable annotations plus `manifest.json`. Use that manifest as an
explicit training overlay instead of overwriting older capture annotations:

```bash
bun run training:prepare -- benchmark-data/live/<run> [...] \
  --adjudication-manifest \
    benchmark-data/review/adjudicated/<campaign>/manifest.json \
  --output benchmark-data/training/<campaign>
```

With an overlay, captures absent from the manifest are skipped, every manifest
page must be consumed by the supplied runs, and observation, screenshot, and
annotation hashes must all match.

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
