// graph2/mockData.ts — synthetic two-remote dataset for story/prototype work.
// shaped to mirror real grimoire data (remote → relation → value → artist → album)
// so swapping in real api calls later is mechanical.

import type { WalkGraph, WalkNode, WalkEdge } from "./types";

// --- helpers ----------------------------------------------------------------

function remote(remoteId: string, label: string, childCount: number): WalkNode {
  return { id: `remote::${remoteId}`, role: "remote", label, parentId: "root", childCount };
}

function relation(remoteId: string, kind: string, label: string, childCount: number): WalkNode {
  return {
    id: `relation::${remoteId}::${kind}`,
    role: "relation",
    label,
    parentId: `remote::${remoteId}`,
    childCount,
  };
}

function value(kind: string, val: string, label: string, childCount: number): WalkNode {
  return {
    id: `value::${kind}::${val}`,
    role: "value",
    label,
    parentId: `relation::local::${kind}`,
    childCount,
  };
}

function artist(remoteId: string, artistId: string, name: string, albumCount: number): WalkNode {
  return {
    id: `artist::${remoteId}::${artistId}`,
    role: "artist",
    label: name,
    parentId: null, // will be linked via edges
    childCount: albumCount,
  };
}

function album(remoteId: string, albumId: string, title: string): WalkNode {
  return {
    id: `album::${remoteId}::${albumId}`,
    role: "album",
    label: title,
    parentId: null, // linked via edges
    childCount: 0,
  };
}

function edge(source: string, target: string): WalkEdge {
  return { source, target };
}

// --- artists + albums (shared between both remotes where ids match) ----------

const LOCAL_ARTISTS: WalkNode[] = [
  artist("local", "a01", "Grouper", 3),
  artist("local", "a02", "Demdike Stare", 4),
  artist("local", "a03", "Arca", 5),
  artist("local", "a04", "The Body", 4),
  artist("local", "a05", "Kamasi Washington", 3),
  artist("local", "a06", "Pharoah Sanders", 4),
  artist("local", "a07", "Wire", 5),
  artist("local", "a08", "Gang of Four", 3),
  artist("local", "a09", "Swans", 6),
  artist("local", "a10", "Sunn O)))", 3),
  artist("local", "a11", "Actress", 4),
  artist("local", "a12", "Burial", 2),
  artist("local", "a13", "Low", 4),
  artist("local", "a14", "Godspeed You! Black Emperor", 3),
  artist("local", "a15", "Explosions in the Sky", 3),
  artist("local", "a16", "Tim Hecker", 4),
  artist("local", "a17", "Stars of the Lid", 2),
  artist("local", "a18", "William Basinski", 3),
  artist("local", "a19", "Oval", 2),
  artist("local", "a20", "Autechre", 5),
  artist("local", "a21", "Aphex Twin", 6),
  artist("local", "a22", "Boards of Canada", 4),
  artist("local", "a23", "Massive Attack", 4),
  artist("local", "a24", "Portishead", 3),
  artist("local", "a25", "Tricky", 3),
  artist("local", "a26", "Flying Lotus", 4),
  artist("local", "a27", "Kendrick Lamar", 5),
  artist("local", "a28", "Madlib", 4),
  artist("local", "a29", "MF DOOM", 3),
  artist("local", "a30", "The Bug", 3),
  artist("local", "a31", "Coil", 5),
  artist("local", "a32", "Current 93", 4),
  artist("local", "a33", "Death in June", 3),
  artist("local", "a34", "Einstürzende Neubauten", 4),
  artist("local", "a35", "Throbbing Gristle", 3),
  artist("local", "a36", "Cabaret Voltaire", 3),
  artist("local", "a37", "This Heat", 2),
  artist("local", "a38", "Pan Sonic", 3),
  artist("local", "a39", "Merzbow", 4),
  artist("local", "a40", "Dead Can Dance", 3),
  artist("local", "a41", "4AD Sampler", 2),
  artist("local", "a42", "Cocteau Twins", 4),
  artist("local", "a43", "The Cure", 5),
  artist("local", "a44", "Joy Division", 3),
  artist("local", "a45", "Bauhaus", 3),
  artist("local", "a46", "Siouxsie and the Banshees", 4),
  artist("local", "a47", "The Slits", 2),
  artist("local", "a48", "Public Image Ltd", 3),
  artist("local", "a49", "Can", 4),
  artist("local", "a50", "Faust", 3),
  artist("local", "a51", "Neu!", 2),
  artist("local", "a52", "Cluster", 2),
  artist("local", "a53", "Harmonia", 2),
  artist("local", "a54", "Miles Davis", 5),
  artist("local", "a55", "John Coltrane", 5),
  artist("local", "a56", "Alice Coltrane", 3),
  artist("local", "a57", "Sun Ra", 4),
  artist("local", "a58", "Albert Ayler", 3),
  artist("local", "a59", "Ornette Coleman", 4),
  artist("local", "a60", "Charles Mingus", 4),
];

const LOCAL_ALBUMS: WalkNode[] = [
  album("local", "lp01", "Dragging a Dead Deer"),
  album("local", "lp02", "A I A: Alien Observer"),
  album("local", "lp03", "Grid of Points"),
  album("local", "lp04", "Moan"),
  album("local", "lp05", "Testpressing #8"),
  album("local", "lp06", "Obwo"),
  album("local", "lp07", "Mutant"),
  album("local", "lp08", "Xen"),
  album("local", "lp09", "Kick II"),
  album("local", "lp10", "No One Deserves Happiness"),
  album("local", "lp11", "I've Seen All I Need to See"),
  album("local", "lp12", "The Witness"),
  album("local", "lp13", "Pharoah"),
  album("local", "lp14", "Live in Paris"),
  album("local", "lp15", "Pink Flag"),
  album("local", "lp16", "154"),
  album("local", "lp17", "Chairs Missing"),
  album("local", "lp18", "Entertainment!"),
  album("local", "lp19", "Solid Gold"),
  album("local", "lp20", "The Great Annihilator"),
  album("local", "lp21", "Cop"),
  album("local", "lp22", "To Be Kind"),
  album("local", "lp23", "White 1"),
  album("local", "lp24", "Flight"),
  album("local", "lp25", "Ghettoville"),
  album("local", "lp26", "Untrue"),
  album("local", "lp27", "Luminous Spaces"),
  album("local", "lp28", "Things We Lost in the Fire"),
  album("local", "lp29", "Lift Your Skinny Fists"),
  album("local", "lp30", "F♯ A♯ ∞"),
  album("local", "lp31", "The Earth Is Not a Cold Dead Place"),
  album("local", "lp32", "Those Who Tell the Truth"),
  // new artists' albums
  album("local", "lp33", "Ravedeath, 1972"),
  album("local", "lp34", "Virgins"),
  album("local", "lp35", "Konoyo"),
  album("local", "lp36", "And Their Refinement of the Decline"),
  album("local", "lp37", "The Disintegration Loops"),
  album("local", "lp38", "Melancholia"),
  album("local", "lp39", "Systemisch"),
  album("local", "lp40", "Tri Repetae"),
  album("local", "lp41", "Untilted"),
  album("local", "lp42", "Richard D. James Album"),
  album("local", "lp43", "Drukqs"),
  album("local", "lp44", "Music Has the Right to Children"),
  album("local", "lp45", "Geogaddi"),
  album("local", "lp46", "Mezzanine"),
  album("local", "lp47", "Dummy"),
  album("local", "lp48", "Maxinquaye"),
  album("local", "lp49", "You're Dead!"),
  album("local", "lp50", "Until the Quiet Comes"),
  album("local", "lp51", "To Pimp a Butterfly"),
  album("local", "lp52", "DAMN."),
  album("local", "lp53", "Madvillainy"),
  album("local", "lp54", "Mm..Food"),
  album("local", "lp55", "Venomous Villain"),
  album("local", "lp56", "London Zoo"),
  album("local", "lp57", "Microscopic Sound"),
  album("local", "lp58", "Scorn"),
  album("local", "lp59", "Abora"),
  album("local", "lp60", "Nun"),
  album("local", "lp61", "Unclean"),
  album("local", "lp62", "Auto-da-Fé"),
  album("local", "lp63", "Current 93 Presents"),
  album("local", "lp64", "Nada!"),
  album("local", "lp65", "Strategies Against Architecture"),
  album("local", "lp66", "Second Annual Report"),
  album("local", "lp67", "Mix-Up"),
  album("local", "lp68", "Deceit"),
  album("local", "lp69", "EP/A1 Sides"),
  album("local", "lp70", "Pulse Demon"),
  album("local", "lp71", "Dead Can Dance"),
  album("local", "lp72", "Within the Realm of a Dying Sun"),
  album("local", "lp73", "Heaven or Las Vegas"),
  album("local", "lp74", "Blue Bell Knoll"),
  album("local", "lp75", "Pornography"),
  album("local", "lp76", "Disintegration"),
  album("local", "lp77", "Unknown Pleasures"),
  album("local", "lp78", "Closer"),
  album("local", "lp79", "In the Flat Field"),
  album("local", "lp80", "Kaleidoscope"),
  album("local", "lp81", "The Scream"),
  album("local", "lp82", "Metal Box"),
  album("local", "lp83", "Tago Mago"),
  album("local", "lp84", "Ege Bamyasi"),
  album("local", "lp85", "Faust IV"),
  album("local", "lp86", "Neu! 2"),
  album("local", "lp87", "Zuckerzeit"),
  album("local", "lp88", "Musik von Harmonia"),
  album("local", "lp89", "Bitches Brew"),
  album("local", "lp90", "Kind of Blue"),
  album("local", "lp91", "A Love Supreme"),
  album("local", "lp92", "Interstellar Space"),
  album("local", "lp93", "World Galaxy"),
  album("local", "lp94", "Spiritual Unity"),
  album("local", "lp95", "Bells"),
  album("local", "lp96", "The Shape of Jazz to Come"),
  album("local", "lp97", "The Black Saint and the Sinner Lady"),
  album("local", "lp98", "Let My Children Hear Music"),
];

// --- freqraid remote (some shared artist names, different ids) ---------------

const RAID_ARTISTS: WalkNode[] = [
  // 3 shared (same name as local, different id — cross-remote matching via name)
  artist("raid", "r01", "Grouper", 2),
  artist("raid", "r02", "Burial", 3),
  artist("raid", "r03", "Arca", 2),
  // unique to freqraid
  artist("raid", "r04", "Coil", 4),
  artist("raid", "r05", "Current 93", 3),
  artist("raid", "r06", "Death in June", 3),
];

const RAID_ALBUMS: WalkNode[] = [
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

// --- build the full graph ----------------------------------------------------

function buildGraph(): WalkGraph {
  const nodes: WalkNode[] = [];
  const edges: WalkEdge[] = [];

  // virtual root
  nodes.push({ id: "root", role: "root", label: "freqhole", parentId: null, childCount: 2 });

  // --- local remote ---
  nodes.push(remote("local", "local (charnel)", 5));
  edges.push(edge("root", "remote::local"));

  // local relations
  const localRelations: [string, string, number][] = [
    ["genres", "genres", 100],
    ["tags", "tags", 8],
    ["favorites", "favorites", 14],
    ["recent_albums", "recent albums", 12],
    ["era", "era", 5],
  ];
  for (const [kind, label, count] of localRelations) {
    nodes.push(relation("local", kind, label, count));
    edges.push(edge("remote::local", `relation::local::${kind}`));
  }

  // genre values for local (~100 genres)
  const localGenres: [string, string, number][] = [
    ["ambient",        "ambient",           14],
    ["post_punk",      "post-punk",          9],
    ["jazz",           "jazz",              12],
    ["noise",          "noise",              7],
    ["drone",          "drone",              6],
    ["shoegaze",       "shoegaze",           8],
    ["dark_wave",      "dark wave",          5],
    ["industrial",     "industrial",        10],
    ["folk",           "folk",              11],
    ["hip_hop",        "hip-hop",           13],
    ["electronic",     "electronic",        18],
    ["experimental",   "experimental",      16],
    ["post_rock",      "post-rock",          7],
    ["krautrock",      "krautrock",          4],
    ["psychedelic",    "psychedelic",        9],
    ["black_metal",    "black metal",        6],
    ["doom_metal",     "doom metal",         5],
    ["slowcore",       "slowcore",           4],
    ["rnb",            "r&b",               11],
    ["soul",           "soul",              10],
    ["funk",           "funk",               8],
    ["reggae",         "reggae",             5],
    ["dub",            "dub",                6],
    ["techno",         "techno",            12],
    ["house",          "house",             10],
    ["trance",         "trance",             4],
    ["breakbeat",      "breakbeat",          5],
    ["jungle",         "jungle",             4],
    ["garage",         "garage",             6],
    ["grime",          "grime",              5],
    ["uk_bass",        "UK bass",            4],
    ["footwork",       "footwork",           3],
    ["deconstructed",  "deconstructed",      5],
    ["new_age",        "new age",            4],
    ["minimalism",     "minimalism",         6],
    ["musique_concrete","musique concrète",  4],
    ["noise_rock",     "noise rock",         6],
    ["math_rock",      "math rock",          5],
    ["emo",            "emo",                4],
    ["hardcore",       "hardcore",           7],
    ["punk",           "punk",               8],
    ["grunge",         "grunge",             5],
    ["indie_rock",     "indie rock",         9],
    ["dream_pop",      "dream pop",          8],
    ["chamber_pop",    "chamber pop",        4],
    ["baroque_pop",    "baroque pop",        3],
    ["art_rock",       "art rock",           6],
    ["glam",           "glam",               4],
    ["progressive",    "progressive",        7],
    ["fusion",         "fusion",             5],
    ["free_jazz",      "free jazz",          5],
    ["bebop",          "bebop",              4],
    ["cool_jazz",      "cool jazz",          3],
    ["modal_jazz",     "modal jazz",         4],
    ["latin_jazz",     "latin jazz",         3],
    ["afrobeat",       "afrobeat",           5],
    ["worldbeat",      "worldbeat",          4],
    ["cumbia",         "cumbia",             3],
    ["bossa_nova",     "bossa nova",         3],
    ["tropicalia",     "tropicália",         3],
    ["neo_soul",       "neo-soul",           7],
    ["conscious_rap",  "conscious rap",      5],
    ["trap",           "trap",               7],
    ["lo_fi_hip_hop",  "lo-fi hip-hop",      6],
    ["cloud_rap",      "cloud rap",          4],
    ["drill",          "drill",              4],
    ["boom_bap",       "boom bap",           6],
    ["abstract_hip_hop","abstract hip-hop",  5],
    ["spoken_word",    "spoken word",        3],
    ["field_recording","field recording",    4],
    ["acousmatic",     "acousmatic",         3],
    ["tape_music",     "tape music",         3],
    ["lowercase",      "lowercase",          2],
    ["power_electronics","power electronics",4],
    ["noise_ambient",  "noise ambient",      5],
    ["dark_ambient",   "dark ambient",       6],
    ["ritual_ambient", "ritual ambient",     4],
    ["liturgical",     "liturgical",         3],
    ["neofolk",        "neofolk",            5],
    ["post_industrial","post-industrial",    5],
    ["ebm",            "EBM",                4],
    ["synth_pop",      "synth-pop",          7],
    ["coldwave",       "coldwave",           4],
    ["ethereal",       "ethereal",           5],
    ["goth_rock",      "goth rock",          5],
    ["electro",        "electro",            5],
    ["idm",            "IDM",                8],
    ["glitch",         "glitch",             6],
    ["microsound",     "microsound",         3],
    ["clicks_cuts",    "clicks & cuts",      2],
    ["illbient",       "illbient",           3],
    ["trip_hop",       "trip-hop",           6],
    ["downtempo",      "downtempo",          6],
    ["chillout",       "chillout",           4],
    ["turntablism",    "turntablism",        3],
    ["spoken",         "spoken",             3],
    ["a_cappella",     "a cappella",         2],
    ["choral",         "choral",             3],
    ["orchestral",     "orchestral",         4],
    ["modern_classical","modern classical",  7],
  ];
  for (const [val, label, count] of localGenres) {
    const n = value("genres", val, label, count);
    // parentId for value nodes is the relation hub
    n.parentId = "relation::local::genres";
    nodes.push(n);
    edges.push(edge("relation::local::genres", `value::genres::${val}`));
  }

  // tag values for local
  const localTags: [string, string, number][] = [
    ["experimental", "experimental", 6],
    ["electronic", "electronic", 5],
    ["acoustic", "acoustic", 3],
    ["live", "live", 4],
    ["instrumental", "instrumental", 7],
    ["collaboration", "collab", 2],
    ["reissue", "reissue", 3],
    ["lo_fi", "lo-fi", 4],
  ];
  for (const [val, label, count] of localTags) {
    const n = value("tags", val, label, count);
    n.parentId = "relation::local::tags";
    nodes.push(n);
    edges.push(edge("relation::local::tags", `value::tags::${val}`));
  }

  // era values for local
  const localEras: [string, string, number][] = [
    ["70s", "1970s", 4],
    ["80s", "1980s", 6],
    ["90s", "1990s", 8],
    ["00s", "2000s", 7],
    ["10s", "2010s", 9],
  ];
  for (const [val, label, count] of localEras) {
    const n = value("era", val, label, count);
    n.parentId = "relation::local::era";
    nodes.push(n);
    edges.push(edge("relation::local::era", `value::era::${val}`));
  }

  // local artists + albums
  nodes.push(...LOCAL_ARTISTS);
  nodes.push(...LOCAL_ALBUMS);

  // artist → album edges (local)
  const artistAlbums: [string, string[]][] = [
    ["a01", ["lp01", "lp02", "lp03"]],
    ["a02", ["lp04", "lp05", "lp06"]],
    ["a03", ["lp07", "lp08", "lp09"]],
    ["a04", ["lp10", "lp11"]],
    ["a05", ["lp12"]],
    ["a06", ["lp13", "lp14"]],
    ["a07", ["lp15", "lp16", "lp17"]],
    ["a08", ["lp18", "lp19"]],
    ["a09", ["lp20", "lp21", "lp22"]],
    ["a10", ["lp23"]],
    ["a11", ["lp24", "lp25"]],
    ["a12", ["lp26"]],
    ["a13", ["lp27", "lp28"]],
    ["a14", ["lp29", "lp30"]],
    ["a15", ["lp31", "lp32"]],
    ["a16", ["lp33", "lp34", "lp35"]],
    ["a17", ["lp36"]],
    ["a18", ["lp37", "lp38"]],
    ["a19", ["lp39"]],
    ["a20", ["lp40", "lp41"]],
    ["a21", ["lp42", "lp43"]],
    ["a22", ["lp44", "lp45"]],
    ["a23", ["lp46"]],
    ["a24", ["lp47"]],
    ["a25", ["lp48"]],
    ["a26", ["lp49", "lp50"]],
    ["a27", ["lp51", "lp52"]],
    ["a28", ["lp53", "lp54"]],
    ["a29", ["lp55"]],
    ["a30", ["lp56"]],
    ["a31", ["lp57", "lp58", "lp59"]],
    ["a32", ["lp60", "lp61", "lp62", "lp63"]],
    ["a33", ["lp64"]],
    ["a34", ["lp65"]],
    ["a35", ["lp66"]],
    ["a36", ["lp67"]],
    ["a37", ["lp68"]],
    ["a38", ["lp69"]],
    ["a39", ["lp70"]],
    ["a40", ["lp71", "lp72"]],
    ["a42", ["lp73", "lp74"]],
    ["a43", ["lp75", "lp76"]],
    ["a44", ["lp77", "lp78"]],
    ["a45", ["lp79"]],
    ["a46", ["lp80", "lp81"]],
    ["a47", ["lp82"]],
    ["a48", ["lp83", "lp84"]],
    ["a49", ["lp83", "lp84"]],
    ["a50", ["lp85"]],
    ["a51", ["lp86"]],
    ["a52", ["lp87"]],
    ["a53", ["lp88"]],
    ["a54", ["lp89", "lp90"]],
    ["a55", ["lp91", "lp92"]],
    ["a56", ["lp93"]],
    ["a57", ["lp94", "lp95"]],
    ["a58", ["lp96"]],  // actually Ornette
    ["a59", ["lp96"]],
    ["a60", ["lp97", "lp98"]],
  ];
  for (const [aId, lps] of artistAlbums) {
    for (const lp of lps) {
      edges.push(edge(`artist::local::${aId}`, `album::local::${lp}`));
    }
  }

  // genre → artist edges (local)
  const genreArtists: Record<string, string[]> = {
    ambient:         ["a01", "a10", "a13", "a14", "a15", "a16", "a17", "a18", "a22"],
    post_punk:       ["a07", "a08", "a43", "a44", "a46", "a47", "a48"],
    jazz:            ["a05", "a06", "a54", "a55", "a56", "a57", "a58", "a59", "a60"],
    noise:           ["a04", "a09", "a37", "a39"],
    drone:           ["a10", "a14", "a17"],
    shoegaze:        ["a01", "a13", "a15", "a42"],
    dark_wave:       ["a09", "a45", "a46"],
    industrial:      ["a02", "a03", "a04", "a34", "a35", "a36"],
    folk:            ["a01", "a13", "a32", "a33"],
    hip_hop:         ["a27", "a28", "a29", "a30"],
    electronic:      ["a02", "a03", "a11", "a12", "a19", "a20", "a21", "a38"],
    experimental:    ["a02", "a03", "a04", "a09", "a10", "a31", "a37"],
    post_rock:       ["a14", "a15", "a16"],
    krautrock:       ["a49", "a50", "a51", "a52", "a53"],
    psychedelic:     ["a31", "a49", "a57"],
    black_metal:     ["a32", "a33"],
    doom_metal:      ["a04", "a10"],
    slowcore:        ["a01", "a13"],
    rnb:             ["a26", "a27"],
    soul:            ["a05", "a06"],
    techno:          ["a11", "a19", "a38"],
    house:           ["a11", "a12"],
    idm:             ["a20", "a21", "a22"],
    glitch:          ["a19", "a20"],
    trip_hop:        ["a23", "a24", "a25", "a26"],
    downtempo:       ["a23", "a24"],
    neo_soul:        ["a26", "a27"],
    conscious_rap:   ["a27", "a28"],
    boom_bap:        ["a28", "a29"],
    abstract_hip_hop:["a28", "a29"],
    free_jazz:       ["a55", "a57", "a58", "a59"],
    modal_jazz:      ["a54", "a55"],
    neofolk:         ["a32", "a33", "a40"],
    post_industrial: ["a34", "a35", "a36"],
    ebm:             ["a34", "a36"],
    synth_pop:       ["a36", "a43"],
    coldwave:        ["a44", "a45"],
    goth_rock:       ["a43", "a44", "a45"],
    ethereal:        ["a40", "a42"],
    dark_ambient:    ["a10", "a16", "a31"],
    ritual_ambient:  ["a31", "a32", "a40"],
    noise_rock:      ["a04", "a09", "a37"],
    noise_ambient:   ["a10", "a16", "a17"],
    musique_concrete:["a18", "a37"],
    field_recording: ["a16", "a18"],
    minimalism:      ["a17", "a18"],
    modern_classical:["a16", "a17", "a18"],
    power_electronics:["a35", "a39"],
    deconstructed:   ["a03", "a19", "a20"],
    microsound:      ["a19", "a38"],
    dream_pop:       ["a01", "a42"],
    lo_fi_hip_hop:   ["a28", "a29"],
    garage:          ["a12", "a11"],
    uk_bass:         ["a12", "a30"],
    art_rock:        ["a07", "a37", "a49"],
    progressive:     ["a49", "a50"],
    // genres that just need some data — artist accuracy not important
    funk:            ["a05", "a06", "a26"],
    reggae:          ["a30", "a47", "a48"],
    dub:             ["a30", "a37", "a48"],
    trance:          ["a19", "a20", "a22"],
    breakbeat:       ["a11", "a12", "a23"],
    jungle:          ["a11", "a12", "a30"],
    grime:           ["a12", "a27", "a30"],
    footwork:        ["a11", "a20", "a26"],
    new_age:         ["a16", "a17", "a18"],
    math_rock:       ["a14", "a15", "a37"],
    emo:             ["a13", "a14", "a15"],
    hardcore:        ["a04", "a09", "a47"],
    punk:            ["a07", "a08", "a47", "a48"],
    grunge:          ["a04", "a09", "a13"],
    indie_rock:      ["a13", "a42", "a43"],
    chamber_pop:     ["a01", "a40", "a42"],
    baroque_pop:     ["a40", "a42", "a45"],
    glam:            ["a43", "a45", "a46"],
    fusion:          ["a54", "a55", "a56", "a26"],
    bebop:           ["a55", "a59", "a60"],
    cool_jazz:       ["a54", "a55", "a59"],
    latin_jazz:      ["a54", "a56", "a57"],
    afrobeat:        ["a05", "a26", "a57"],
    worldbeat:       ["a40", "a56", "a57"],
    cumbia:          ["a56", "a57", "a60"],
    bossa_nova:      ["a54", "a55", "a56"],
    tropicalia:      ["a56", "a57", "a60"],
    trap:            ["a27", "a29", "a30"],
    cloud_rap:       ["a27", "a28", "a29"],
    drill:           ["a27", "a29", "a30"],
    spoken_word:     ["a32", "a33", "a57"],
    acousmatic:      ["a16", "a17", "a18"],
    tape_music:      ["a18", "a35", "a37"],
    lowercase:       ["a16", "a18", "a19"],
    liturgical:      ["a32", "a40", "a56"],
    electro:         ["a11", "a20", "a21"],
    clicks_cuts:     ["a19", "a20", "a38"],
    illbient:        ["a02", "a23", "a25"],
    chillout:        ["a22", "a23", "a24"],
    turntablism:     ["a26", "a28", "a29"],
    spoken:          ["a32", "a35", "a57"],
    a_cappella:      ["a40", "a42", "a56"],
    choral:          ["a16", "a40", "a56"],
    orchestral:      ["a14", "a15", "a16"],
  };
  for (const [genre, artists] of Object.entries(genreArtists)) {
    for (const aId of artists) {
      edges.push(edge(`value::genres::${genre}`, `artist::local::${aId}`));
    }
  }

  // tag → artist edges (local)
  const tagArtists: Record<string, string[]> = {
    experimental:  ["a02", "a03", "a04", "a09", "a10", "a19", "a20", "a21", "a31"],
    electronic:    ["a02", "a03", "a11", "a12", "a20", "a21", "a38"],
    acoustic:      ["a01", "a13", "a33"],
    live:          ["a05", "a06", "a09", "a54"],
    instrumental:  ["a10", "a14", "a15", "a17", "a20", "a22"],
    collaboration: ["a04", "a09", "a26"],
    reissue:       ["a06", "a07", "a35"],
    lo_fi:         ["a01", "a12", "a29"],
  };
  for (const [tag, artists] of Object.entries(tagArtists)) {
    for (const aId of artists) {
      edges.push(edge(`value::tags::${tag}`, `artist::local::${aId}`));
    }
  }

  // favorites → artist edges (local)
  for (const aId of ["a01", "a03", "a05", "a09", "a12", "a14", "a20", "a21", "a27", "a31", "a42", "a54", "a55"]) {
    edges.push(edge("relation::local::favorites", `artist::local::${aId}`));
  }

  // recent_albums → album edges (most recently added to library)
  for (const lpId of ["lp26", "lp43", "lp44", "lp52", "lp53", "lp46", "lp07", "lp33", "lp89", "lp91", "lp40", "lp76"]) {
    edges.push(edge("relation::local::recent_albums", `album::local::${lpId}`));
  }

  // era → artist edges (some overlap intentional)
  const eraArtists: Record<string, string[]> = {
    "70s": ["a06", "a07", "a08", "a49", "a50", "a51", "a52", "a53", "a54", "a55", "a56", "a57", "a58", "a59", "a60"],
    "80s": ["a08", "a09", "a34", "a35", "a36", "a37", "a40", "a42", "a43", "a44", "a45", "a46", "a47", "a48"],
    "90s": ["a04", "a07", "a10", "a14", "a20", "a21", "a22", "a23", "a24", "a25", "a31"],
    "00s": ["a01", "a09", "a12", "a15", "a16", "a17", "a18", "a19", "a26", "a29"],
    "10s": ["a02", "a03", "a11", "a13", "a27", "a28", "a30"],
  };
  for (const [era, artists] of Object.entries(eraArtists)) {
    for (const aId of artists) {
      edges.push(edge(`value::era::${era}`, `artist::local::${aId}`));
    }
  }

  // --- freqraid remote ---
  nodes.push(remote("raid", "freqraid", 3));
  edges.push(edge("root", "remote::raid"));

  const raidRelations: [string, string, number][] = [
    ["genres", "genres", 4],
    ["tags", "tags", 5],
    ["favorites", "favorites", 3],
  ];
  for (const [kind, label, count] of raidRelations) {
    const rid = `relation::raid::${kind}`;
    nodes.push({ id: rid, role: "relation", label, parentId: "remote::raid", childCount: count });
    edges.push(edge("remote::raid", rid));
  }

  // raid genre values
  const raidGenres: [string, string, number][] = [
    ["ambient", "ambient", 3],
    ["post_punk", "post-punk", 2],
    ["folk", "folk", 4],
    ["neofolk", "neofolk", 3],
  ];
  for (const [val, label, count] of raidGenres) {
    const vid = `value::raid_genres::${val}`;
    nodes.push({ id: vid, role: "value", label, parentId: `relation::raid::genres`, childCount: count });
    edges.push(edge("relation::raid::genres", vid));
  }

  nodes.push(...RAID_ARTISTS);
  nodes.push(...RAID_ALBUMS);

  // raid artist → album edges
  const raidAlbums: [string, string[]][] = [
    ["r01", ["rl01", "rl02"]],      // Grouper
    ["r02", ["rl03", "rl04", "rl05"]], // Burial
    ["r03", ["rl06"]],              // Arca
    ["r04", ["rl07", "rl08"]],      // Coil
    ["r05", ["rl09", "rl10", "rl11"]], // Current 93
    ["r06", ["rl12", "rl13"]],      // Death in June
  ];
  for (const [aId, lps] of raidAlbums) {
    for (const lp of lps) {
      edges.push(edge(`artist::raid::${aId}`, `album::raid::${lp}`));
    }
  }

  // raid genre → artist
  const raidGenreArtists: Record<string, string[]> = {
    ambient:   ["r01", "r04"],
    post_punk: [],
    folk:      ["r05", "r06"],
    neofolk:   ["r04", "r05", "r06"],
  };
  for (const [genre, artists] of Object.entries(raidGenreArtists)) {
    for (const aId of artists) {
      edges.push(edge(`value::raid_genres::${genre}`, `artist::raid::${aId}`));
    }
  }

  // raid favorites
  for (const aId of ["r01", "r04", "r05"]) {
    edges.push(edge("relation::raid::favorites", `artist::raid::${aId}`));
  }

  return { nodes, edges };
}

export const MOCK_GRAPH: WalkGraph = buildGraph();
