/**
 * @typedef {{ id: string, start: string, end: string }} GraphEdge
 * @typedef {{ nodeId: string, includeNeighbors: boolean }} Selection
 */

/**
 * @param {string} renderedId
 * @param {string} diagramId
 */
export function graphNodeId(renderedId, diagramId) {
  const id = renderedId.slice(diagramId.length + 1);
  return id.replace(/^flowchart-(.*)-\d+$/, "$1");
}

/**
 * @param {Selection | undefined} previous
 * @param {string} nodeId
 * @param {GraphEdge[]} edges
 */
export function selectGraphNode(previous, nodeId, edges) {
  const includeNeighbors = previous?.nodeId === nodeId && !previous.includeNeighbors;
  const nodeIds = new Set([nodeId]);
  const edgeIds = new Set();
  for (const edge of edges) {
    if (edge.start !== nodeId && edge.end !== nodeId) continue;
    edgeIds.add(edge.id);
    if (includeNeighbors) {
      nodeIds.add(edge.start);
      nodeIds.add(edge.end);
    }
  }
  return { nodeId, includeNeighbors, nodeIds, edgeIds };
}
