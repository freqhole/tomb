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
  // electronic / uk bass / post-dubstep cluster
  artist("local", "a61", "Four Tet", 3),
  artist("local", "a62", "Squarepusher", 3),
  artist("local", "a63", "Bibio", 2),
  artist("local", "a64", "Mount Kimbie", 2),
  artist("local", "a65", "Jon Hopkins", 3),
  artist("local", "a66", "Andy Stott", 3),
  artist("local", "a67", "Raime", 2),
  artist("local", "a68", "Objekt", 2),
  artist("local", "a69", "Floating Points", 3),
  artist("local", "a70", "Lone", 2),
  artist("local", "a71", "Bonobo", 3),
  artist("local", "a72", "Jamie xx", 2),
  artist("local", "a73", "James Blake", 3),
  artist("local", "a74", "FKA Twigs", 2),
  artist("local", "a75", "Kelela", 2),
  artist("local", "a76", "Laurel Halo", 3),
  artist("local", "a77", "Holly Herndon", 2),
  // underground hip-hop cluster
  artist("local", "a78", "J Dilla", 3),
  artist("local", "a79", "JPEGMAFIA", 3),
  artist("local", "a80", "billy woods", 3),
  artist("local", "a81", "Armand Hammer", 2),
  artist("local", "a82", "Quelle Chris", 2),
  artist("local", "a83", "Moor Mother", 3),
  artist("local", "a84", "Open Mike Eagle", 2),
  // post-punk / art-rock revival cluster
  artist("local", "a85", "Dry Cleaning", 2),
  artist("local", "a86", "black midi", 3),
  artist("local", "a87", "Squid", 2),
  artist("local", "a88", "Shame", 3),
  artist("local", "a89", "Idles", 3),
  artist("local", "a90", "Fontaines D.C.", 3),
  // UK jazz / contemporary jazz cluster
  artist("local", "a91", "Shabaka Hutchings", 3),
  artist("local", "a92", "Nubya Garcia", 2),
  artist("local", "a93", "Makaya McCraven", 3),
  artist("local", "a94", "Irreversible Entanglements", 2),
  artist("local", "a95", "Moses Sumney", 2),
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
  // four tet
  album("local", "lp99",  "Rounds"),
  album("local", "lp100", "There Is Love in You"),
  album("local", "lp101", "Sixteen Oceans"),
  // squarepusher
  album("local", "lp102", "Hard Normal Daddy"),
  album("local", "lp103", "Ultravisitor"),
  album("local", "lp104", "Feed Me Weird Things"),
  // bibio
  album("local", "lp105", "Ambivalence Avenue"),
  album("local", "lp106", "Silver Wilkinson"),
  // mount kimbie
  album("local", "lp107", "Crooks & Lovers"),
  album("local", "lp108", "Love What Survives"),
  // jon hopkins
  album("local", "lp109", "Immunity"),
  album("local", "lp110", "Singularity"),
  album("local", "lp111", "Piano Versions"),
  // andy stott
  album("local", "lp112", "Luxury Problems"),
  album("local", "lp113", "Faith in Strangers"),
  album("local", "lp114", "Too Many Voices"),
  // raime
  album("local", "lp115", "Quarter Turns"),
  album("local", "lp116", "Tooth"),
  // objekt
  album("local", "lp117", "Flatland"),
  album("local", "lp118", "Needle & Thread"),
  // floating points
  album("local", "lp119", "Elaenia"),
  album("local", "lp120", "Crush"),
  album("local", "lp121", "Promises"),
  // lone
  album("local", "lp122", "Galaxy Garden"),
  album("local", "lp123", "Reality Testing"),
  // bonobo
  album("local", "lp124", "Black Sands"),
  album("local", "lp125", "The North Borders"),
  album("local", "lp126", "Migration"),
  // jamie xx
  album("local", "lp127", "In Colour"),
  album("local", "lp128", "In Waves"),
  // james blake
  album("local", "lp129", "James Blake"),
  album("local", "lp130", "Overgrown"),
  album("local", "lp131", "The Colour in Anything"),
  // fka twigs
  album("local", "lp132", "LP1"),
  album("local", "lp133", "Magdalene"),
  // kelela
  album("local", "lp134", "Take Me Apart"),
  album("local", "lp135", "Raven"),
  // laurel halo
  album("local", "lp136", "Quarantine"),
  album("local", "lp137", "Dust"),
  album("local", "lp138", "Atlas"),
  // holly herndon
  album("local", "lp139", "Platform"),
  album("local", "lp140", "Proto"),
  // j dilla
  album("local", "lp141", "Donuts"),
  album("local", "lp142", "The Shining"),
  album("local", "lp143", "Welcome 2 Detroit"),
  // jpegmafia
  album("local", "lp144", "Veteran"),
  album("local", "lp145", "All My Heroes Are Cornballs"),
  album("local", "lp146", "LP!"),
  // billy woods
  album("local", "lp147", "Hiding Places"),
  album("local", "lp148", "Maps"),
  album("local", "lp149", "Church"),
  // armand hammer
  album("local", "lp150", "Shrines"),
  album("local", "lp151", "Haram"),
  // quelle chris
  album("local", "lp152", "Guns"),
  album("local", "lp153", "Innocent Country 2"),
  // moor mother
  album("local", "lp154", "Fetish Bones"),
  album("local", "lp155", "Brass"),
  album("local", "lp156", "Black Encyclopedia of the Air"),
  // open mike eagle
  album("local", "lp157", "Brick Body Kids Still Daydream"),
  album("local", "lp158", "Anime, Trauma and Divorce"),
  // dry cleaning
  album("local", "lp159", "New Long Leg"),
  album("local", "lp160", "Stumpwork"),
  // black midi
  album("local", "lp161", "Schlagenheim"),
  album("local", "lp162", "Cavalcade"),
  album("local", "lp163", "Hellfire"),
  // squid
  album("local", "lp164", "Bright Green Field"),
  album("local", "lp165", "O Monolith"),
  // shame
  album("local", "lp166", "Songs of Praise"),
  album("local", "lp167", "Drunk Tank Pink"),
  album("local", "lp168", "Food for Worms"),
  // idles
  album("local", "lp169", "Joy as an Act of Resistance"),
  album("local", "lp170", "Ultra Mono"),
  album("local", "lp171", "Crawler"),
  // fontaines d.c.
  album("local", "lp172", "Dogrel"),
  album("local", "lp173", "A Hero's Death"),
  album("local", "lp174", "Skinty Fia"),
  // shabaka hutchings
  album("local", "lp175", "Wisdom of Elders"),
  album("local", "lp176", "We Are Sent Here by History"),
  album("local", "lp177", "To Wisdom the Prize"),
  // nubya garcia
  album("local", "lp178", "Source"),
  album("local", "lp179", "Source (We Move)"),
  // makaya mccraven
  album("local", "lp180", "Universal Beings"),
  album("local", "lp181", "In These Times"),
  album("local", "lp182", "Deciphering the Message"),
  // irreversible entanglements
  album("local", "lp183", "Irreversible Entanglements"),
  album("local", "lp184", "Open the Gates"),
  // moses sumney
  album("local", "lp185", "Aromanticism"),
  album("local", "lp186", "Græ"),
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
    ["mood", "mood", 8],
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
    ["uk_garage",      "UK garage",          5],
    ["acid",           "acid",               4],
    ["witch_house",    "witch house",        4],
    ["ambient_techno", "ambient techno",     5],
    ["hyperpop",       "hyperpop",           4],
    ["post_dubstep",   "post-dubstep",       5],
    ["bass_music",     "bass music",         5],
    ["uk_jazz",        "UK jazz",            4],
    ["nu_jazz",        "nu jazz",            4],
    ["leftfield",      "leftfield",          5],
    ["noise_pop",      "noise pop",          4],
    ["contemporary_classical", "contemporary classical", 4],
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

  // mood values for local (taxon kind: mood — albums get 1-2 moods)
  const localMoods: [string, string][] = [
    ["dark",         "dark"],
    ["atmospheric",  "atmospheric"],
    ["meditative",   "meditative"],
    ["aggressive",   "aggressive"],
    ["melancholic",  "melancholic"],
    ["hypnotic",     "hypnotic"],
    ["haunting",     "haunting"],
    ["energetic",    "energetic"],
  ];
  for (const [val, label] of localMoods) {
    const n = value("mood", val, label, 0); // childCount recomputed from edges
    n.parentId = "relation::local::mood";
    nodes.push(n);
    edges.push(edge("relation::local::mood", `value::mood::${val}`));
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
    ["a61", ["lp99",  "lp100", "lp101"]],
    ["a62", ["lp102", "lp103", "lp104"]],
    ["a63", ["lp105", "lp106"]],
    ["a64", ["lp107", "lp108"]],
    ["a65", ["lp109", "lp110", "lp111"]],
    ["a66", ["lp112", "lp113", "lp114"]],
    ["a67", ["lp115", "lp116"]],
    ["a68", ["lp117", "lp118"]],
    ["a69", ["lp119", "lp120", "lp121"]],
    ["a70", ["lp122", "lp123"]],
    ["a71", ["lp124", "lp125", "lp126"]],
    ["a72", ["lp127", "lp128"]],
    ["a73", ["lp129", "lp130", "lp131"]],
    ["a74", ["lp132", "lp133"]],
    ["a75", ["lp134", "lp135"]],
    ["a76", ["lp136", "lp137", "lp138"]],
    ["a77", ["lp139", "lp140"]],
    ["a78", ["lp141", "lp142", "lp143"]],
    ["a79", ["lp144", "lp145", "lp146"]],
    ["a80", ["lp147", "lp148", "lp149"]],
    ["a81", ["lp150", "lp151"]],
    ["a82", ["lp152", "lp153"]],
    ["a83", ["lp154", "lp155", "lp156"]],
    ["a84", ["lp157", "lp158"]],
    ["a85", ["lp159", "lp160"]],
    ["a86", ["lp161", "lp162", "lp163"]],
    ["a87", ["lp164", "lp165"]],
    ["a88", ["lp166", "lp167", "lp168"]],
    ["a89", ["lp169", "lp170", "lp171"]],
    ["a90", ["lp172", "lp173", "lp174"]],
    ["a91", ["lp175", "lp176", "lp177"]],
    ["a92", ["lp178", "lp179"]],
    ["a93", ["lp180", "lp181", "lp182"]],
    ["a94", ["lp183", "lp184"]],
    ["a95", ["lp185", "lp186"]],
  ];
  for (const [aId, lps] of artistAlbums) {
    for (const lp of lps) {
      edges.push(edge(`artist::local::${aId}`, `album::local::${lp}`));
    }
  }

  // genre → artist edges (local)
  const genreArtists: Record<string, string[]> = {
    ambient:         ["a01", "a10", "a13", "a14", "a15", "a16", "a17", "a18", "a22", "a61", "a65", "a69", "a70", "a71", "a76"],
    post_punk:       ["a07", "a08", "a43", "a44", "a46", "a47", "a48", "a85", "a86", "a87", "a88", "a89", "a90"],
    jazz:            ["a05", "a06", "a54", "a55", "a56", "a57", "a58", "a59", "a60", "a91", "a92", "a93", "a94"],
    noise:           ["a04", "a09", "a37", "a39"],
    drone:           ["a10", "a14", "a17"],
    shoegaze:        ["a01", "a13", "a15", "a42"],
    dark_wave:       ["a09", "a45", "a46"],
    industrial:      ["a02", "a03", "a04", "a34", "a35", "a36"],
    folk:            ["a01", "a13", "a32", "a33"],
    hip_hop:         ["a27", "a28", "a29", "a30", "a78", "a79", "a80", "a81", "a82", "a83", "a84"],
    electronic:      ["a02", "a03", "a11", "a12", "a19", "a20", "a21", "a38", "a61", "a62", "a64", "a65", "a66", "a67", "a68", "a70", "a71", "a72", "a76", "a77"],
    experimental:    ["a02", "a03", "a04", "a09", "a10", "a31", "a37", "a76", "a77", "a79", "a83", "a86"],
    post_rock:       ["a14", "a15", "a16"],
    krautrock:       ["a49", "a50", "a51", "a52", "a53"],
    psychedelic:     ["a31", "a49", "a57"],
    black_metal:     ["a32", "a33"],
    doom_metal:      ["a04", "a10"],
    slowcore:        ["a01", "a13"],
    rnb:             ["a26", "a27"],
    soul:            ["a05", "a06"],
    techno:          ["a11", "a19", "a38", "a66", "a68"],
    house:           ["a11", "a12"],
    idm:             ["a20", "a21", "a22", "a61", "a62", "a65"],
    glitch:          ["a19", "a20", "a61", "a62"],
    trip_hop:        ["a23", "a24", "a25", "a26", "a71", "a72", "a73"],
    downtempo:       ["a23", "a24", "a61", "a71", "a72"],
    neo_soul:        ["a26", "a27", "a73", "a74", "a75", "a95"],
    conscious_rap:   ["a27", "a28", "a80", "a83", "a84"],
    boom_bap:        ["a28", "a29", "a78", "a84"],
    abstract_hip_hop:["a28", "a29", "a78", "a79", "a80", "a81", "a82", "a83", "a84"],
    free_jazz:       ["a55", "a57", "a58", "a59", "a94"],
    modal_jazz:      ["a54", "a55"],
    neofolk:         ["a32", "a33", "a40"],
    post_industrial: ["a34", "a35", "a36"],
    ebm:             ["a34", "a36"],
    synth_pop:       ["a36", "a43"],
    coldwave:        ["a44", "a45"],
    goth_rock:       ["a43", "a44", "a45"],
    ethereal:        ["a40", "a42"],
    dark_ambient:    ["a10", "a16", "a31", "a66", "a67", "a76"],
    ritual_ambient:  ["a31", "a32", "a40"],
    noise_rock:      ["a04", "a09", "a37", "a86", "a88"],
    noise_ambient:   ["a10", "a16", "a17"],
    musique_concrete:["a18", "a37"],
    field_recording: ["a16", "a18"],
    minimalism:      ["a17", "a18"],
    modern_classical:["a16", "a17", "a18", "a65", "a69", "a77"],
    power_electronics:["a35", "a39"],
    deconstructed:   ["a03", "a19", "a20", "a74", "a76", "a77"],
    microsound:      ["a19", "a38"],
    dream_pop:       ["a01", "a42"],
    lo_fi_hip_hop:   ["a28", "a29"],
    garage:          ["a12", "a11"],
    uk_bass:         ["a12", "a30", "a64", "a72", "a73", "a74"],
    art_rock:        ["a07", "a37", "a49", "a86", "a87", "a95"],
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
    math_rock:       ["a14", "a15", "a37", "a86", "a87"],
    emo:             ["a13", "a14", "a15"],
    hardcore:        ["a04", "a09", "a47"],
    punk:            ["a07", "a08", "a47", "a48"],
    grunge:          ["a04", "a09", "a13"],
    indie_rock:      ["a13", "a42", "a43", "a85", "a88", "a89", "a90"],
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
    // new genres
    uk_garage:       ["a12", "a64", "a72", "a73"],
    acid:            ["a21", "a61", "a62"],
    witch_house:     ["a02", "a67", "a76"],
    ambient_techno:  ["a61", "a65", "a66", "a68", "a69"],
    hyperpop:        ["a74", "a77", "a79"],
    post_dubstep:    ["a12", "a64", "a72", "a73", "a74"],
    bass_music:      ["a12", "a30", "a64", "a72", "a73"],
    uk_jazz:         ["a69", "a91", "a92", "a93"],
    nu_jazz:         ["a69", "a91", "a93"],
    leftfield:       ["a61", "a62", "a69", "a76", "a77"],
    noise_pop:       ["a04", "a86", "a88"],
    contemporary_classical: ["a65", "a69", "a77"],
  };
  for (const [genre, artists] of Object.entries(genreArtists)) {
    for (const aId of artists) {
      edges.push(edge(`value::genres::${genre}`, `artist::local::${aId}`));
    }
  }

  // genre → album edges (real schema: taxons attach to albums, not just artists)
  const genreAlbums: Record<string, string[]> = {
    ambient:      ["lp01","lp02","lp03","lp23","lp27","lp29","lp31","lp33","lp34","lp35","lp36","lp37","lp38","lp88","lp99","lp100","lp101","lp109","lp110","lp119","lp122","lp136","lp137","lp175","lp176"],
    electronic:   ["lp04","lp05","lp06","lp07","lp08","lp09","lp24","lp25","lp26","lp39","lp40","lp41","lp42","lp43","lp99","lp100","lp102","lp103","lp107","lp108","lp112","lp117","lp118","lp119","lp120","lp127","lp128","lp129","lp139","lp140"],
    hip_hop:      ["lp49","lp50","lp51","lp52","lp53","lp54","lp55","lp56","lp141","lp142","lp143","lp144","lp145","lp146","lp147","lp148","lp149","lp150","lp151","lp152","lp153","lp154","lp155","lp156","lp157","lp158"],
    jazz:         ["lp12","lp13","lp14","lp89","lp90","lp91","lp92","lp93","lp94","lp95","lp97","lp98","lp119","lp121","lp175","lp176","lp177","lp178","lp179","lp180","lp181","lp182","lp183","lp184"],
    post_punk:    ["lp15","lp16","lp17","lp18","lp19","lp68","lp75","lp77","lp78","lp79","lp80","lp81","lp82","lp159","lp160","lp161","lp162","lp166","lp167","lp168","lp169","lp172","lp173","lp174"],
    industrial:   ["lp04","lp05","lp06","lp57","lp58","lp65","lp66","lp67","lp69","lp112","lp113","lp115","lp116"],
    experimental: ["lp07","lp08","lp20","lp21","lp39","lp40","lp57","lp68","lp70","lp83","lp84","lp94","lp95","lp102","lp103","lp144","lp145","lp154","lp155","lp161","lp162","lp163","lp183"],
    idm:          ["lp39","lp40","lp41","lp42","lp43","lp44","lp45","lp99","lp100","lp101","lp102","lp103","lp104","lp109"],
    trip_hop:     ["lp46","lp47","lp48","lp49","lp50","lp127","lp128","lp129","lp130","lp131"],
    dark_ambient: ["lp23","lp57","lp58","lp59","lp112","lp113","lp114","lp115","lp116"],
    noise:        ["lp10","lp11","lp20","lp21","lp66","lp70"],
    drone:        ["lp10","lp23","lp29","lp30","lp36","lp37"],
    krautrock:    ["lp83","lp84","lp85","lp86","lp87","lp88"],
    free_jazz:    ["lp91","lp92","lp94","lp95","lp96","lp183","lp184"],
    shoegaze:     ["lp01","lp02","lp73","lp74","lp76"],
    goth_rock:    ["lp75","lp76","lp77","lp78","lp79","lp80","lp81"],
    neofolk:      ["lp60","lp61","lp62","lp63","lp64","lp71","lp72"],
    dream_pop:    ["lp01","lp02","lp03","lp27","lp73","lp74","lp129","lp130","lp185","lp186"],
    abstract_hip_hop: ["lp53","lp54","lp55","lp141","lp142","lp147","lp148","lp149","lp150","lp151","lp152","lp153","lp156","lp157","lp158"],
    post_rock:    ["lp29","lp30","lp31","lp32","lp33","lp109","lp110"],
    noise_rock:   ["lp10","lp11","lp20","lp68","lp161","lp162","lp163","lp166"],
    uk_garage:    ["lp26","lp107","lp108","lp127","lp128","lp129"],
    deconstructed:["lp07","lp08","lp09","lp39","lp132","lp133","lp139","lp140"],
    neo_soul:     ["lp49","lp50","lp51","lp52","lp129","lp130","lp131","lp134","lp135","lp185","lp186"],
  };
  for (const [genre, albums] of Object.entries(genreAlbums)) {
    for (const lpId of albums) {
      edges.push(edge(`value::genres::${genre}`, `album::local::${lpId}`));
    }
  }

  // mood → album edges
  const moodAlbums: Record<string, string[]> = {
    dark:        ["lp10","lp20","lp21","lp23","lp26","lp30","lp57","lp58","lp65","lp66","lp70","lp75","lp77","lp78","lp79","lp112","lp113","lp115","lp116","lp154","lp155","lp161","lp162","lp163","lp183","lp184"],
    atmospheric: ["lp01","lp02","lp27","lp29","lp31","lp33","lp34","lp36","lp37","lp38","lp46","lp88","lp99","lp109","lp119","lp136","lp137","lp175","lp176"],
    meditative:  ["lp88","lp90","lp91","lp93","lp119","lp121","lp122","lp175","lp180","lp181","lp185","lp186"],
    aggressive:  ["lp11","lp15","lp18","lp20","lp70","lp102","lp103","lp104","lp144","lp161","lp162","lp163","lp166","lp167","lp169","lp170"],
    melancholic: ["lp01","lp02","lp03","lp13","lp27","lp28","lp47","lp75","lp76","lp129","lp130","lp131","lp134","lp135","lp185","lp186"],
    hypnotic:    ["lp04","lp05","lp06","lp39","lp40","lp44","lp45","lp83","lp84","lp107","lp108","lp113","lp117","lp118"],
    haunting:    ["lp03","lp26","lp32","lp59","lp71","lp72","lp73","lp74","lp79","lp80","lp115","lp136","lp154","lp183","lp184"],
    energetic:   ["lp07","lp08","lp09","lp15","lp18","lp51","lp52","lp53","lp102","lp103","lp104","lp144","lp145","lp146","lp161","lp169","lp170"],
  };
  for (const [mood, albums] of Object.entries(moodAlbums)) {
    for (const lpId of albums) {
      edges.push(edge(`value::mood::${mood}`, `album::local::${lpId}`));
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

  // similar artist edges (directed, based on lastfm/audiodb-style similarity)
  const artistSimilar: [string, string[]][] = [
    ["a01", ["a13", "a16", "a42"]],          // Grouper
    ["a02", ["a11", "a31", "a67"]],          // Demdike Stare
    ["a03", ["a20", "a74", "a76"]],          // Arca
    ["a04", ["a09", "a10", "a37"]],          // The Body
    ["a05", ["a06", "a91", "a92"]],          // Kamasi Washington
    ["a06", ["a05", "a55", "a56"]],          // Pharoah Sanders
    ["a07", ["a08", "a48", "a85"]],          // Wire
    ["a08", ["a07", "a47", "a88"]],          // Gang of Four
    ["a09", ["a04", "a34", "a39"]],          // Swans
    ["a10", ["a14", "a17", "a66"]],          // Sunn O)))
    ["a11", ["a02", "a12", "a68"]],          // Actress
    ["a12", ["a11", "a64", "a72"]],          // Burial
    ["a13", ["a01", "a15", "a42"]],          // Low
    ["a14", ["a10", "a15", "a17"]],          // Godspeed
    ["a15", ["a14", "a16", "a17"]],          // Explosions
    ["a16", ["a15", "a17", "a18"]],          // Tim Hecker
    ["a17", ["a16", "a18", "a10"]],          // Stars of the Lid
    ["a18", ["a17", "a16", "a19"]],          // Basinski
    ["a19", ["a20", "a38", "a62"]],          // Oval
    ["a20", ["a21", "a22", "a61"]],          // Autechre
    ["a21", ["a20", "a22", "a62"]],          // Aphex Twin
    ["a22", ["a21", "a20", "a63"]],          // Boards of Canada
    ["a23", ["a24", "a25", "a71"]],          // Massive Attack
    ["a24", ["a23", "a25", "a73"]],          // Portishead
    ["a25", ["a23", "a24", "a48"]],          // Tricky
    ["a26", ["a05", "a27", "a69"]],          // Flying Lotus
    ["a27", ["a26", "a28", "a80"]],          // Kendrick
    ["a28", ["a27", "a29", "a78"]],          // Madlib
    ["a29", ["a28", "a78", "a82"]],          // MF DOOM
    ["a30", ["a12", "a11", "a73"]],          // The Bug
    ["a31", ["a32", "a33", "a40"]],          // Coil
    ["a32", ["a31", "a33", "a40"]],          // Current 93
    ["a33", ["a31", "a32", "a40"]],          // Death in June
    ["a34", ["a35", "a36", "a04"]],          // Neubauten
    ["a35", ["a34", "a36", "a39"]],          // TG
    ["a36", ["a34", "a35", "a43"]],          // Cabaret Voltaire
    ["a37", ["a04", "a09", "a35"]],          // This Heat
    ["a38", ["a19", "a20", "a66"]],          // Pan Sonic
    ["a39", ["a09", "a35", "a04"]],          // Merzbow
    ["a40", ["a31", "a32", "a42"]],          // Dead Can Dance
    ["a42", ["a01", "a13", "a40"]],          // Cocteau Twins
    ["a43", ["a44", "a45", "a46"]],          // The Cure
    ["a44", ["a43", "a45", "a46"]],          // Joy Division
    ["a45", ["a43", "a44", "a46"]],          // Bauhaus
    ["a46", ["a43", "a44", "a45"]],          // Siouxsie
    ["a47", ["a48", "a07", "a08"]],          // The Slits
    ["a48", ["a47", "a07", "a25"]],          // PiL
    ["a49", ["a50", "a51", "a52"]],          // Can
    ["a50", ["a49", "a51", "a52"]],          // Faust
    ["a51", ["a49", "a50", "a53"]],          // Neu!
    ["a52", ["a51", "a53", "a49"]],          // Cluster
    ["a53", ["a52", "a51", "a50"]],          // Harmonia
    ["a54", ["a55", "a56", "a57"]],          // Miles Davis
    ["a55", ["a54", "a56", "a57"]],          // Coltrane
    ["a56", ["a55", "a57", "a58"]],          // Alice Coltrane
    ["a57", ["a54", "a58", "a94"]],          // Sun Ra
    ["a58", ["a59", "a57", "a94"]],          // Ayler
    ["a59", ["a58", "a60", "a57"]],          // Ornette
    ["a60", ["a59", "a55", "a58"]],          // Mingus
    ["a61", ["a62", "a22", "a63"]],          // Four Tet
    ["a62", ["a61", "a21", "a20"]],          // Squarepusher
    ["a63", ["a61", "a22", "a70"]],          // Bibio
    ["a64", ["a12", "a72", "a73"]],          // Mount Kimbie
    ["a65", ["a16", "a69", "a71"]],          // Jon Hopkins
    ["a66", ["a67", "a02", "a38"]],          // Andy Stott
    ["a67", ["a66", "a02", "a76"]],          // Raime
    ["a68", ["a11", "a12", "a69"]],          // Objekt
    ["a69", ["a65", "a68", "a91"]],          // Floating Points
    ["a70", ["a61", "a63", "a71"]],          // Lone
    ["a71", ["a23", "a65", "a70"]],          // Bonobo
    ["a72", ["a12", "a64", "a73"]],          // Jamie xx
    ["a73", ["a72", "a74", "a75"]],          // James Blake
    ["a74", ["a03", "a73", "a75"]],          // FKA Twigs
    ["a75", ["a74", "a73", "a26"]],          // Kelela
    ["a76", ["a67", "a79", "a77"]],          // Laurel Halo
    ["a77", ["a76", "a03", "a79"]],          // Holly Herndon
    ["a78", ["a28", "a29", "a81"]],          // J Dilla
    ["a79", ["a80", "a82", "a83"]],          // JPEGMAFIA
    ["a80", ["a79", "a81", "a84"]],          // billy woods
    ["a81", ["a80", "a78", "a29"]],          // Armand Hammer
    ["a82", ["a80", "a81", "a84"]],          // Quelle Chris
    ["a83", ["a80", "a84", "a94"]],          // Moor Mother
    ["a84", ["a80", "a82", "a83"]],          // Open Mike Eagle
    ["a85", ["a86", "a87", "a88"]],          // Dry Cleaning
    ["a86", ["a85", "a87", "a88"]],          // black midi
    ["a87", ["a85", "a86", "a88"]],          // Squid
    ["a88", ["a85", "a86", "a89"]],          // Shame
    ["a89", ["a88", "a90", "a07"]],          // Idles
    ["a90", ["a89", "a88", "a07"]],          // Fontaines D.C.
    ["a91", ["a92", "a93", "a69"]],          // Shabaka Hutchings
    ["a92", ["a91", "a93", "a05"]],          // Nubya Garcia
    ["a93", ["a91", "a92", "a94"]],          // Makaya McCraven
    ["a94", ["a57", "a83", "a93"]],          // Irreversible Entanglements
    ["a95", ["a73", "a26", "a89"]],          // Moses Sumney
  ];
  for (const [aId, related] of artistSimilar) {
    for (const rId of related) {
      edges.push(edge(`artist::local::${aId}`, `artist::local::${rId}`));
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
