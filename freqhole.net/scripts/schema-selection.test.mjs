import assert from "node:assert/strict";
import { test } from "node:test";
import { graphNodeId, selectGraphNode } from "../src/components/schema-selection.mjs";

test("rendered ER and flowchart node IDs match graph edge endpoints", () => {
  assert.equal(graphNodeId("schema-2-entity-grimoire_album_imagez-0", "schema-2"), "entity-grimoire_album_imagez-0");
  assert.equal(graphNodeId("schema-3-flowchart-grimoire_album_query_view-99", "schema-3"), "grimoire_album_query_view");
});

const edges = [
  { id: "ab", start: "a", end: "b" },
  { id: "ca", start: "c", end: "a" },
  { id: "bd", start: "b", end: "d" },
  { id: "aa", start: "a", end: "a" },
];

test("selection highlights incoming, outgoing and self edges, but fits only the node", () => {
  const selected = selectGraphNode(undefined, "a", edges);
  assert.equal(selected.includeNeighbors, false);
  assert.deepEqual([...selected.nodeIds], ["a"]);
  assert.deepEqual([...selected.edgeIds], ["ab", "ca", "aa"]);
});

test("repeated activation alternates single-node and one-hop neighborhood fits", () => {
  const first = selectGraphNode(undefined, "a", edges);
  const second = selectGraphNode(first, "a", edges);
  assert.equal(second.includeNeighbors, true);
  assert.deepEqual([...second.nodeIds], ["a", "b", "c"]);
  assert.deepEqual(second.edgeIds, first.edgeIds);
  assert.deepEqual(selectGraphNode(second, "a", edges), first);
});

test("switching nodes or clearing selection starts with a single-node fit", () => {
  const previous = selectGraphNode(selectGraphNode(undefined, "a", edges), "a", edges);
  assert.deepEqual([...selectGraphNode(previous, "b", edges).nodeIds], ["b"]);
  assert.equal(selectGraphNode(undefined, "a", edges).includeNeighbors, false);
});

test("isolated nodes remain selectable in both fit modes", () => {
  const first = selectGraphNode(undefined, "isolated", edges);
  const second = selectGraphNode(first, "isolated", edges);
  assert.deepEqual([...second.nodeIds], ["isolated"]);
  assert.equal(second.edgeIds.size, 0);
  assert.equal(second.includeNeighbors, true);
});
