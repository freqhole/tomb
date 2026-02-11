// fuzzy track matching for musicbrainz integration
// matches local songs to MB tracks by title similarity + duration comparison
// used when track numbers in the local database are incorrect or missing

export interface FuzzyCandidate {
  /** unique identifier (song id or disc:position key) */
  id: string;
  title: string;
  /** duration in milliseconds */
  durationMs: number;
}

export interface FuzzyMatchResult {
  /** index into the local songs array */
  localIndex: number;
  /** index into the MB tracks array, or null if unmatched */
  mbIndex: number | null;
  /** match confidence score (0-1), 0 if unmatched */
  score: number;
}

/** normalize title: lowercase, strip punctuation, split into word tokens */
function tokenize(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0);
  return new Set(words);
}

/** jaccard similarity of two word-token sets (0-1) */
function titleSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 && tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

/** duration similarity (0-1), based on relative difference */
function durationSimilarity(aMs: number, bMs: number): number {
  const maxMs = Math.max(aMs, bMs);
  if (maxMs === 0) return 0;
  return Math.max(0, 1 - Math.abs(aMs - bMs) / maxMs);
}

/** check if a title is too generic to rely on for matching */
function isGenericTitle(title: string): boolean {
  const lower = title.toLowerCase().trim();
  if (!lower || lower === "unknown" || lower === "unknown track" || lower === "untitled") {
    return true;
  }
  return /^track\s*\d+$/i.test(lower);
}

/**
 * compute fuzzy matches between local songs and MB tracks.
 * uses title jaccard similarity + duration comparison with greedy assignment.
 * returns one result per local song (with mbIndex = null if no good match found).
 */
export function computeFuzzyMatches(
  local: FuzzyCandidate[],
  mb: FuzzyCandidate[],
): FuzzyMatchResult[] {
  if (local.length === 0) return [];
  if (mb.length === 0) {
    return local.map((_, i) => ({ localIndex: i, mbIndex: null, score: 0 }));
  }

  // compute all pairwise scores
  const scores: { localIdx: number; mbIdx: number; score: number }[] = [];
  for (let li = 0; li < local.length; li++) {
    for (let mi = 0; mi < mb.length; mi++) {
      const titleScore = titleSimilarity(local[li].title, mb[mi].title);
      const durScore = durationSimilarity(local[li].durationMs, mb[mi].durationMs);

      // weight: lean on duration if either title is generic
      const titleGeneric = isGenericTitle(local[li].title) || isGenericTitle(mb[mi].title);
      const combined = titleGeneric
        ? 0.1 * titleScore + 0.9 * durScore
        : 0.5 * titleScore + 0.5 * durScore;

      scores.push({ localIdx: li, mbIdx: mi, score: combined });
    }
  }

  // greedy assignment: best scores first
  scores.sort((a, b) => b.score - a.score);

  const usedLocal = new Set<number>();
  const usedMb = new Set<number>();
  const assignments = new Map<number, { mbIdx: number; score: number }>();

  for (const { localIdx, mbIdx, score } of scores) {
    if (usedLocal.has(localIdx) || usedMb.has(mbIdx)) continue;
    // only accept matches with a minimum score threshold
    if (score < 0.15) continue;
    assignments.set(localIdx, { mbIdx, score });
    usedLocal.add(localIdx);
    usedMb.add(mbIdx);
  }

  // build results for every local song
  return local.map((_, i) => {
    const match = assignments.get(i);
    return {
      localIndex: i,
      mbIndex: match?.mbIdx ?? null,
      score: match?.score ?? 0,
    };
  });
}

/**
 * check whether fuzzy matching would produce different pairings than position matching.
 * takes two arrays of [localId, mbId] pairs and checks if any differ.
 */
export function detectMismatch(
  positionPairs: { localId: string | null; mbId: string | null }[],
  fuzzyPairs: { localId: string | null; mbId: string | null }[],
): boolean {
  // build a map of localId -> mbId for fuzzy result
  const fuzzyMap = new Map<string, string | null>();
  for (const p of fuzzyPairs) {
    if (p.localId) fuzzyMap.set(p.localId, p.mbId);
  }

  // check if any position-matched local song would get a different MB track
  for (const p of positionPairs) {
    if (!p.localId) continue;
    const fuzzyMbId = fuzzyMap.get(p.localId);
    if (fuzzyMbId === undefined) continue; // not in fuzzy set
    if (fuzzyMbId !== p.mbId) return true;
  }

  return false;
}
