import type { ObservedNode } from "./contracts";

export function selectIndependentCandidateRootIds(
  nodes: readonly Pick<ObservedNode, "id" | "parentId">[],
  candidateIds: readonly string[]
): string[] {
  const parentById = new Map(nodes.map((node) => [node.id, node.parentId]));
  const candidates = new Set(candidateIds);
  const ancestorCandidates = new Set<string>();

  for (const candidateId of candidates) {
    const visited = new Set<string>();
    let parentId = parentById.get(candidateId);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      if (parentId !== candidateId && candidates.has(parentId)) {
        ancestorCandidates.add(parentId);
      }
      parentId = parentById.get(parentId);
    }
  }

  const seen = new Set<string>();
  return candidateIds.filter((candidateId) => {
    if (seen.has(candidateId) || ancestorCandidates.has(candidateId)) {
      return false;
    }
    seen.add(candidateId);
    return true;
  });
}
