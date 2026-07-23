import type { ObservationBounds, ObservedNode, PageObservation } from "./contracts";

export function cropObservationToRegion(
  observation: PageObservation,
  region: ObservationBounds
): PageObservation {
  const nodeMap = new Map(observation.nodes.map((node) => [node.id, node]));
  const includedIds = new Set<string>();

  for (const node of observation.nodes) {
    if (!boundsIntersect(node.bounds, region)) continue;
    let current: ObservedNode | undefined = node;
    while (current) {
      includedIds.add(current.id);
      current = current.parentId ? nodeMap.get(current.parentId) : undefined;
    }
  }

  return {
    ...observation,
    viewport: {
      width: region.width,
      height: region.height,
      scrollX: region.x,
      scrollY: region.y
    },
    nodes: observation.nodes.filter((node) => includedIds.has(node.id)),
    sourceRegion: region
  };
}

export function boundsIntersect(left: ObservationBounds, right: ObservationBounds): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}
