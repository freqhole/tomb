import {
  forceSimulation,
  forceLink,
  forceCollide,
  forceX,
  forceY,
  forceManyBody,
} from "d3-force";
import {
  clusterRemotes,
  crossRemoteEdges,
  nodeMap,
  post,
  state,
  type SimLink,
  type SimNode,
} from "./walkerState";
import {
  crossKey,
  leaderOf,
  nodeRadius,
  pivot,
  remoteHubId,
  remoteOfId,
} from "./walkerHelpers";
import { computeTargets, getVisible } from "./walkerLayout";
import type { TopologyEdge, VisibleNode } from "./messages";

// ---- rebuild sim from current walk state -----------------------------------

export function buildSim() {
  if (state.sim) state.sim.stop();

  const visible = getVisible();
  const cx = state.width / 2;
  const cy = state.height / 2;
  const targets = computeTargets(pivot(), visible, cx, cy);
  const pivLeader = leaderOf(pivot());
  // pivot-aware spacing knob: any pivot artist gets a personal-space
  // cordon, scaled by catalog size. small catalogs still get cleared
  // breathing room; big catalogs get proportionally more. `pivotBoost`
  // ramps from ~0.1 (1 album) toward a soft cap of 1.5 (15+ albums).
  //
  // CLUSTER-AWARE COUNT: aggregated artists (dashed-stroke, multiple
  // members merged across remotes via slug) count their *combined*
  // catalog, not just the leader's own albums. we walk fullGraph.edges
  // with leaderOf collapse and tally unique album leader ids attached
  // to pivLeader.
  const pivLeaderNode = nodeMap.get(pivLeader);
  const pivotIsArtist = pivLeaderNode?.role === "artist";
  const pivotAlbumChildren = new Set<string>();
  if (pivotIsArtist) {
    for (const e of state.fullGraph.edges) {
      const rs = typeof e.source === "string" ? e.source : (e.source as SimNode).id;
      const rt = typeof e.target === "string" ? e.target : (e.target as SimNode).id;
      const ls = leaderOf(rs);
      const lt = leaderOf(rt);
      const sn = nodeMap.get(ls);
      const tn = nodeMap.get(lt);
      if (!sn || !tn) continue;
      if (ls === pivLeader && sn.role === "artist" && tn.role === "album") {
        pivotAlbumChildren.add(lt);
      } else if (lt === pivLeader && tn.role === "artist" && sn.role === "album") {
        pivotAlbumChildren.add(ls);
      }
    }
  }
  const pivotAlbumCount = pivotAlbumChildren.size;
  const pivotBoost = pivotIsArtist
    ? Math.min(Math.max(pivotAlbumCount, 1) / 10, 1.5)
    : 0;
  const pivotActive = pivotIsArtist;
  // strategy A — breadcrumb may contain member ids; collapse to leader ids so
  // the visible leader still reads as "on breadcrumb path" (drives stroke +
  // label tints).
  const breadcrumbSet = new Set(state.breadcrumb.map(leaderOf));

  // build sim nodes, preserving existing positions when available
  const prevPositions = new Map<string, { x: number; y: number }>();
  if (state.sim) {
    for (const n of state.sim.nodes()) {
      if (Number.isFinite(n.x) && Number.isFinite(n.y)) {
        prevPositions.set(n.id, { x: n.x!, y: n.y! });
      }
    }
  }

  const simNodes: SimNode[] = [];
  const idToIdx = new Map<string, number>();

  for (const id of visible) {
    const wn = nodeMap.get(id);
    if (!wn) continue;
    const target = targets.get(id) ?? { x: cx, y: cy };
    const prev = prevPositions.get(id);
    // for the pivot artist when aggregated across cluster members, use
    // the cluster-wide album count so the visual node + collide reflect
    // the true catalog size (otherwise dashed-stroke aggregated artists
    // look small relative to their actual fan-out).
    const effectiveChildCount =
      id === pivLeader && pivotIsArtist && pivotAlbumCount > wn.childCount
        ? pivotAlbumCount
        : wn.childCount;
    const r = nodeRadius(wn.role, effectiveChildCount);
    const sn: SimNode = {
      id,
      role: wn.role,
      childCount: effectiveChildCount,
      radius: r,
      targetX: target.x,
      targetY: target.y,
      // start at prev position if known, else slightly perturbed target
      x: prev?.x ?? target.x + (Math.random() - 0.5) * 20,
      y: prev?.y ?? target.y + (Math.random() - 0.5) * 20,
    };
    idToIdx.set(id, simNodes.length);
    simNodes.push(sn);
  }

  // build sim edges (between visible nodes only). source/target are mapped
  // through leaderOf() so edges that originally connected cluster followers
  // (related-artist, parent-child, etc) still emit between the surviving
  // leader nodes after strategy A collapse. self-loops (both endpoints in
  // the same cluster) are dropped silently.
  const simLinks: SimLink[] = [];
  const visibleEdges: TopologyEdge[] = [];
  const emittedEdgeKeys = new Set<string>(); // dedupe forward + cross-remote

  for (const e of state.fullGraph.edges) {
    const rawSrc = typeof e.source === "string" ? e.source : (e.source as SimNode).id;
    const rawTgt = typeof e.target === "string" ? e.target : (e.target as SimNode).id;
    const src = leaderOf(rawSrc);
    const tgt = leaderOf(rawTgt);
    if (src === tgt) continue;
    const si = idToIdx.get(src);
    const ti = idToIdx.get(tgt);
    if (si === undefined || ti === undefined) continue;
    const key = crossKey(src, tgt);
    if (emittedEdgeKeys.has(key)) continue;
    const isBC = breadcrumbSet.has(src) && breadcrumbSet.has(tgt);
    simLinks.push({ source: src, target: tgt, isBreadcrumb: isBC, isRelatedArtist: e.isRelatedArtist });
    visibleEdges.push({
      sourceIdx: si,
      targetIdx: ti,
      isBreadcrumb: isBC,
      isRelatedArtist: e.isRelatedArtist,
      isPending: e.isPending,
    });
    emittedEdgeKeys.add(key);
  }

  // phase 3: emit synthesized cross-remote artist/album links.
  //
  // re-routing: instead of drawing a dashed wire between two cluster
  // leaders (which crowds the entity space in the middle of the canvas),
  // route each cross-remote bridge to the *other* endpoint's remote hub.
  // visually this reads as "this entity also lives on $remote", and the
  // wires terminate at the periphery (remote hubs) rather than tangling
  // through the cluster interior. when both endpoints already collapsed
  // into the same cluster (strategy A already absorbed the bridge) the
  // dashed edge is skipped entirely. when the remote hubs aren't visible
  // we fall back to the legacy leader↔leader dashed edge so the bridge
  // still surfaces.
  for (const key of crossRemoteEdges) {
    const [a, b] = key.split("||");
    const lA = leaderOf(a);
    const lB = leaderOf(b);
    if (lA === lB) continue; // already merged by clustering
    const remoteA = remoteOfId(a);
    const remoteB = remoteOfId(b);
    const hubA = remoteA ? remoteHubId(remoteA) : null;
    const hubB = remoteB ? remoteHubId(remoteB) : null;
    const lAIdx = idToIdx.get(lA);
    const lBIdx = idToIdx.get(lB);
    const hubAIdx = hubA ? idToIdx.get(hubA) : undefined;
    const hubBIdx = hubB ? idToIdx.get(hubB) : undefined;

    let emittedAny = false;
    // lA → remote hub of b's remote
    if (lAIdx !== undefined && hubBIdx !== undefined && lA !== hubB) {
      const k = crossKey(lA, hubB!);
      if (!emittedEdgeKeys.has(k)) {
        simLinks.push({ source: lA, target: hubB!, isBreadcrumb: false });
        visibleEdges.push({
          sourceIdx: lAIdx,
          targetIdx: hubBIdx,
          isBreadcrumb: false,
          isCrossRemote: true,
        });
        emittedEdgeKeys.add(k);
        emittedAny = true;
      }
    }
    // lB → remote hub of a's remote
    if (lBIdx !== undefined && hubAIdx !== undefined && lB !== hubA) {
      const k = crossKey(lB, hubA!);
      if (!emittedEdgeKeys.has(k)) {
        simLinks.push({ source: lB, target: hubA!, isBreadcrumb: false });
        visibleEdges.push({
          sourceIdx: lBIdx,
          targetIdx: hubAIdx,
          isBreadcrumb: false,
          isCrossRemote: true,
        });
        emittedEdgeKeys.add(k);
        emittedAny = true;
      }
    }
    // fallback: neither remote hub is visible — keep the legacy direct
    // leader↔leader dashed edge so the bridge doesn't vanish.
    if (!emittedAny && lAIdx !== undefined && lBIdx !== undefined) {
      const k = crossKey(lA, lB);
      if (!emittedEdgeKeys.has(k)) {
        simLinks.push({ source: lA, target: lB, isBreadcrumb: false });
        visibleEdges.push({
          sourceIdx: lAIdx,
          targetIdx: lBIdx,
          isBreadcrumb: false,
          isCrossRemote: true,
        });
        emittedEdgeKeys.add(k);
      }
    }
  }

  // emit topology before starting sim so main thread can render immediately
  const topologyNodes: VisibleNode[] = simNodes.map((n) => ({
    id: n.id,
    role: n.role as VisibleNode["role"],
    label: nodeMap.get(n.id)?.label ?? n.id,
    childCount: n.childCount,
    isPivot: n.id === pivLeader,
    isBreadcrumb: breadcrumbSet.has(n.id),
    tint: nodeMap.get(n.id)?.tint,
    isCharnelManaged: nodeMap.get(n.id)?.isCharnelManaged,
    contributorRemotes: clusterRemotes.get(n.id),
  }));
  post({ type: "topology", nodes: topologyNodes, edges: visibleEdges });
  post({ type: "visibleIds", ids: simNodes.map((n) => n.id) });

  // capture live pivot sim node so cordon reads current position each
  // tick. nodeMap holds walk-graph nodes; we need the SimNode whose x/y
  // updates every tick. pivotAlbumChildren was computed up-front (cluster-
  // aware) so the cordon can exempt the inner album ring.
  const pivotSimNode = pivotActive
    ? simNodes[idToIdx.get(pivLeader) ?? -1]
    : undefined;
  // max album radius among pivot's children — sets how wide the
  // protected inner ring must be before everything else gets evicted.
  let pivotMaxAlbumR = 0;
  if (pivotActive) {
    for (const aid of pivotAlbumChildren) {
      const idx = idToIdx.get(aid);
      if (idx === undefined) continue;
      const r = simNodes[idx].radius;
      if (r > pivotMaxAlbumR) pivotMaxAlbumR = r;
    }
  }
  // cordon radius: pivot disc + full album ring + generous padding
  // that scales with album count. for a 30-album artist this clears
  // ~600px around the pivot, evicting hub nodes and ghost satellites
  // to the periphery.
  const cordonR = pivotActive && pivotSimNode
    ? pivotSimNode.radius + pivotMaxAlbumR * 2.6 + 220 + pivotBoost * 180
    : 0;

  // custom cordon force: every tick, push non-album-of-pivot nodes
  // outward if they're inside the cordon. uses an alpha-scaled
  // velocity nudge proportional to (cordonR - dist), so deeply
  // penetrating nodes are evicted hard while just-outside nodes feel
  // nothing. this is the lever that finally clears space around fat
  // pivots in dense (multi-remote) graphs — conventional charge alone
  // can't reach far enough.
  function cordonForce(alpha: number) {
    if (!pivotActive || !pivotSimNode) return;
    const px = pivotSimNode.x ?? 0;
    const py = pivotSimNode.y ?? 0;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    for (const n of simNodes) {
      if (n.id === pivLeader) continue;
      if (pivotAlbumChildren.has(n.id)) continue;
      // ghost related artists are reference points — they should sit
      // near the pivot, not get evicted to the periphery. they're
      // tiny (r=8) and label-only so they don't crowd anything.
      if (n.role === "ghost_artist") continue;
      const dx = (n.x ?? 0) - px;
      const dy = (n.y ?? 0) - py;
      const d2 = dx * dx + dy * dy;
      if (d2 >= cordonR * cordonR) continue;
      const d = Math.sqrt(d2) || 0.0001;
      const push = (cordonR - d) * 0.22 * alpha;
      n.vx = (n.vx ?? 0) + (dx / d) * push;
      n.vy = (n.vy ?? 0) + (dy / d) * push;
    }
  }

  state.sim = forceSimulation<SimNode, SimLink>(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((d) => {
          const s = d.source as SimNode;
          const t = d.target as SimNode;
          // album edges: tight inner ring, even more so when the
          // parent is the selected pivot (creates a cohesive catalog
          // halo against which the pivot's repulsion field can clear
          // outer space).
          if (s.role === "artist" && t.role === "album") {
            const tight = s.id === pivLeader && pivotActive
              ? Math.max(1.05, 1.3 - pivotBoost * 0.15)
              : 1.3;
            return (s.radius + t.radius) * tight;
          }
          // every other edge touching the pivot artist (related-artist,
          // taxon hubs, value chips...) gets pushed outward in
          // proportion to the catalog size. one knob, every edge type.
          const base = d.isRelatedArtist
            ? (s.radius + t.radius) * 1.6
            : s.role === "value"
              ? (s.radius + t.radius) * 4.7  // value→x fan-out
              : (s.radius + t.radius) * 2.6;
          if (pivotActive && (s.id === pivLeader || t.id === pivLeader)) {
            return base * (1 + pivotBoost * 1.2);
          }
          return base;
        })
        .strength((d) => {
          const s = d.source as SimNode;
          const t = d.target as SimNode;
          // album edges: lock tight (near-max) so the catalog ring
          // shrugs off every other attractor pulling at the albums.
          if (s.role === "artist" && t.role === "album") {
            return s.id === pivLeader && pivotActive
              ? Math.min(1, 0.95 + pivotBoost * 0.05)
              : 0.95;
          }
          // every other edge touching the pivot artist gets RELAXED
          // — related-artist links, hub connections, ghost satellites
          // — so they don't yank the pivot off-center or crowd the
          // album ring. base strength varies by edge type but pivot-
          // touching ones are uniformly divided by `1 + boost * 2`.
          const base = d.isRelatedArtist ? 0.6 : 0.22;
          if (pivotActive && (s.id === pivLeader || t.id === pivLeader)) {
            return base / (1 + pivotBoost * 2);
          }
          return base;
        }),
    )
    .force(
      "collide",
      forceCollide<SimNode>()
        // a bit more breathing room around leaves so labels/artwork don't
        // overlap as aggressively. hubs stay generous so their fan-outs
        // don't get squashed. artist/album collide bumped slightly so
        // there's some visible padding around each tile even when packed.
        // NOTE: keep pivot artist's collide modest — its big personal-
        // space bubble is enforced by the strong negative charge below,
        // not by collide, because a huge collide radius would fight the
        // album spring (albums sit at ~1.3 * sum-of-radii and would get
        // shoved out of formation by an oversized pivot collide).
        .radius((d) => {
          if (d.role === "album") return d.radius * 1.55;
          if (d.role === "artist") return d.radius * 1.8;
          return d.radius * 1.9;
        })
        .strength(1.0)
        .iterations(4),
    )
    .force(
      "x",
      forceX<SimNode>((d) => d.targetX).strength((d) => {
        if (d.role === "album") return 0.45;
        // when pivot is a fat artist, relax the bloom-target homing
        // on every satellite so they can drift outward under the
        // pivot's strong negative charge instead of being yanked
        // back to their original placement.
        if (pivotActive && d.id !== pivLeader) {
          return Math.max(0.05, 0.18 - pivotBoost * 0.09);
        }
        return 0.18;
      }),
    )
    .force(
      "y",
      forceY<SimNode>((d) => d.targetY).strength((d) => {
        if (d.role === "album") return 0.45;
        if (pivotActive && d.id !== pivLeader) {
          return Math.max(0.05, 0.18 - pivotBoost * 0.09);
        }
        return 0.18;
      }),
    )
    .force(
      "charge",
      forceManyBody<SimNode>()
        // hubs (relation/value) push harder than leaves so dense
        // clusters fan out. the pivot artist with a fat catalog gets a
        // dramatically larger negative charge — combined with
        // distanceMax=1400 it reaches every ghost satellite and clears
        // outer space without disturbing the tight album ring (which
        // is held in place by the near-max album spring).
        .strength((d) => {
          if (d.role === "value" || d.role === "relation" || d.role === "group") return -180;
          if (d.role === "artist") {
            if (d.id === pivLeader && pivotActive) {
              return -(400 + pivotBoost * 600);
            }
            return -90;
          }
          if (d.role === "album") return -20;
          return -55;
        })
        .distanceMax(1400),
    )
    .force("cordon", cordonForce)
    .alphaDecay(0.015)
    .velocityDecay(0.42)
    .on("tick", onTick);

  if (state.paused) state.sim.stop();
}

// ---- tick → emit frame -----------------------------------------------------

export function onTick() {
  if (!state.sim) return;
  const nodes = state.sim.nodes();
  const positions = new Float32Array(nodes.length * 2);
  for (let i = 0; i < nodes.length; i++) {
    positions[i * 2] = nodes[i].x ?? 0;
    positions[i * 2 + 1] = nodes[i].y ?? 0;
  }
  post({ type: "frame", positions, alpha: state.sim.alpha() });
}
