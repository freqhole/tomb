import type { WalkNode } from "../types";
import { artist, album } from "./factories";

// some artist names match local artists (cross-remote matching by name);
// ids are intentionally different so id-based matching skips them.
export const RAID_ARTISTS: WalkNode[] = [
  artist("raid", "r01", "Grouper", 2),
  artist("raid", "r02", "Burial", 3),
  artist("raid", "r03", "Arca", 2),
  artist("raid", "r04", "Coil", 4),
  artist("raid", "r05", "Current 93", 3),
  artist("raid", "r06", "Death in June", 3),
];

export const RAID_ALBUMS: WalkNode[] = [
  album("raid", "rl01", "Ruins"),
  album("raid", "rl02", "Paradise Valley"),
  album("raid", "rl03", "Rival Dealer"),
  album("raid", "rl04", "Kindred"),
  album("raid", "rl05", "Weddings and Funerals"),
  album("raid", "rl06", "Rage of Narcissus"),
  album("raid", "rl07", "Musick to Play in the Dark Vol. 1"),
  album("raid", "rl08", "The Ape of Naples"),
  album("raid", "rl09", "Swastikas for Noddy"),
  album("raid", "rl10", "All the Pretty Little Horses"),
  album("raid", "rl11", "The Giddy Edge of Light"),
  album("raid", "rl12", "Something Is Coming"),
  album("raid", "rl13", "I,II"),
];
