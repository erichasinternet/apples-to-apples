import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseAutoresearchLedger,
  validateAutoresearchLedger,
  validateAutoresearchPolicy,
  type AutoresearchPolicy
} from "./autoresearch-lib";

const policyPath = path.resolve("training/autoresearch/gates.json");
const ledgerPath = path.resolve("training/experiments/evidence-pointer-results.tsv");
const [policyText, ledgerText] = await Promise.all([
  readFile(policyPath, "utf8"),
  readFile(ledgerPath, "utf8")
]);
const policy = JSON.parse(policyText) as AutoresearchPolicy;
const rows = parseAutoresearchLedger(ledgerText);
const errors = [
  ...validateAutoresearchPolicy(policy),
  ...validateAutoresearchLedger(rows, policy)
];

if (errors.length > 0) {
  throw new Error(`Invalid autoresearch state:\n${errors.join("\n")}`);
}

const ledgerSpend = rows.reduce((sum, row) => sum + Number(row.cost_usd), 0);
process.stdout.write(
  `${JSON.stringify(
    {
      valid: true,
      experiments: rows.length,
      estimatedPriorSpendUsd: policy.budget.estimatedSpentUsd,
      ledgerSpendUsd: ledgerSpend,
      projectedTotalSpendUsd: policy.budget.estimatedSpentUsd + ledgerSpend,
      remainingTotalBudgetUsd:
        policy.budget.totalUsd - policy.budget.estimatedSpentUsd - ledgerSpend,
      protectedFinalReserveUsd: policy.budget.finalReserveUsd
    },
    null,
    2
  )}\n`
);
