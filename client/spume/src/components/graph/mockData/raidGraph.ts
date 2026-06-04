export const RAID_RELATIONS: [string, string, number][] = [
  ["genres", "genres", 4],
  ["tags", "tags", 5],
  ["favorites", "favorites", 3],
];

export const RAID_GENRES: [string, string, number][] = [
  ["ambient", "ambient", 3],
  ["post_punk", "post-punk", 2],
  ["folk", "folk", 4],
  ["neofolk", "neofolk", 3],
];

export const RAID_ARTIST_ALBUMS: [string, string[]][] = [
  ["r01", ["rl01", "rl02"]],
  ["r02", ["rl03", "rl04", "rl05"]],
  ["r03", ["rl06"]],
  ["r04", ["rl07", "rl08"]],
  ["r05", ["rl09", "rl10", "rl11"]],
  ["r06", ["rl12", "rl13"]],
];

export const RAID_GENRE_ARTISTS: Record<string, string[]> = {
  ambient:   ["r01", "r04"],
  post_punk: [],
  folk:      ["r05", "r06"],
  neofolk:   ["r04", "r05", "r06"],
};

export const RAID_FAVORITE_ARTISTS: string[] = ["r01", "r04", "r05"];
