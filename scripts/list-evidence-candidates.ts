import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import {
  enumerateEvidenceCandidates,
  serializeEvidenceCandidateCatalog
} from "../src/learning/evidence-pointer";

const [observationArg, cardNodeId] = process.argv.slice(2);
if (!observationArg || !cardNodeId) {
  throw new Error(
    "Usage: bun scripts/list-evidence-candidates.ts observation.json card-node-id"
  );
}
const observation = JSON.parse(
  await readFile(path.resolve(observationArg), "utf8")
) as PageObservation;
const candidates = enumerateEvidenceCandidates(observation, cardNodeId);
if (!observation.nodes.some((node) => node.id === cardNodeId)) {
  throw new Error(`Unknown card node ${cardNodeId}`);
}
process.stdout.write(
  `${JSON.stringify(
    {
      pageId: observation.pageId,
      cardNodeId,
      candidates,
      modelCatalog: JSON.parse(
        serializeEvidenceCandidateCatalog(observation, cardNodeId)
      )
    },
    null,
    2
  )}\n`
);
