// INSPOBOX genre-fit rubric for the live-feed vision gate — distilled from
// sourcing/genre-rubric.md (the same standard the curated feed was audited
// against). Master rule: judge by core idea + 2–3 hallmarks together, never
// by palette or mood alone.
export const RUBRIC = {
  "surreal": "Core: dream/unconscious logic subverting reality — impossible juxtapositions of familiar things, biomorphic hybrids, uncanny dreamscapes. NOT coherent fantasy worlds, cute whimsy, or psychedelic swirls alone.",
  "art-deco": "Core: 1920s–early-30s machine-age LUXURY. Hallmarks: VERTICAL emphasis, symmetry, ornament — zigzag/chevron/sunburst/stepped forms, Egyptian/Aztec motifs, lacquer/chrome/gold/ebony, jewel tones, glamorous figures/posters/architecture of the era. Deciding test vs Art Moderne: vertical + ornate + gold = Deco.",
  "art-moderne": "Core: 1930s–45 aerodynamic streamlining (Streamline Moderne). Hallmarks: HORIZONTAL emphasis, asymmetry, curved/rounded corners, smooth plain (often white) surfaces, glass block, portholes, chrome trim, ocean-liner/train forms, minimal ornament. Deciding test vs Deco: horizontal + curved + plain = Moderne; vertical + ornate + gold = Deco (reject).",
  "mid-century": "Core: 1945–69 post-war democratic living / atomic-age optimism. Hallmarks: clean lines, low/open forms, teak/walnut, molded plywood/fiberglass, tapered legs, mustard/orange/teal on warm neutrals, period pulp/retro-future illustration. NOT cyberpunk portraits, NOT generic retro.",
  "pop": "Core: appropriation of MASS COMMERCIAL culture — advertising, packaging, celebrity, comics, Hollywood — reframed as art. Hallmarks: flat/hard-edged, serial repetition, screen-print/Ben-Day dots, wit, glamour, big-business gloss. Comic-style art counts ONLY when it reframes mass-media iconography as pop commentary. NOT vaporwave (pastel, Greco-Roman busts, tech nostalgia, glitch), NOT psychedelic posters.",
  "afrofuturism": "Core: Black diasporic culture, history and liberation fused with science fiction, technology and cosmic futures. REQUIRES BOTH: African signifiers (textiles, pattern, regalia, mythology, diaspora identity) AND futurism (tech, space, advanced science). NOT a Black portrait alone, NOT generic sci-fi with an incidental Black character, NOT historical tribal/Egyptian imagery alone.",
  "brutalist": "Core: béton brut — honest raw concrete, exposed structure, massive monolithic massing, repetitive modules, zero ornament, civic/institutional monumentality. NOT smooth white minimalist concrete, NOT plain slabs/parking garages, NOT merely grey/dark buildings.",
  "cyberpunk": "Core: 'high tech, low life' — advanced technology inside social decay/corporate dystopia. Hallmarks: dense neon night megacity (cyan/magenta on dark, rain/smog, wet reflections, holographic ads, towers over slums) AND grit/augmentation/transgression. NOT clean chrome sci-fi, spaceships, utopias, synthwave sunsets, or neon alone.",
  "film-noir": "Core: 1940s–50s crime, cynicism and moral ambiguity. Hallmarks: B&W (or near-monochrome) low-key chiaroscuro, half-shadowed faces, Venetian-blind shadows, rain-slick streets, lamps/neon in fog, smoke, detective/femme fatale archetypes, period setting. NOT any B&W photo, NOT merely dark/moody modern scenes, no modern tech in frame.",
  "gothic": "Core: medieval Gothic architecture (pointed arch, rib vault, flying buttress, spires, gargoyles, tracery, stained glass, soaring verticality) AND/OR literary Gothic — ruins, decay, the supernatural, the past intruding on the present. NOT generic dark fantasy, NOT gore/horror, NOT goth fashion alone, NOT anime in dark dress.",
  "minimalist": "Core: rigorous reduction to geometric essence — literal, no symbolism or narrative; grids, serial repetition, industrial materials, negative space AS composition. NOT merely plain/simple/empty scenes, NOT cozy Scandi/Japandi furnished rooms, NOT 'a photo with sky in it' — the restraint must be deliberate and composed.",
  "solarpunk": "Core: an optimistic future where the climate crisis is being answered. REQUIRES ALL THREE: (1) a FUTURISTIC built environment, (2) architecture integrated into lush nature (green roofs/facades, vertical forests), (3) visible renewable tech / community life in bright daylight. NOT generic pretty landscapes, NOT fantasy or cottagecore villages, NOT cozy cabins/greenhouses, NOT nature scenery with no built future, NOT a tower with a token plant.",
  "steampunk": "Core: an alternative Victorian era where steam power stayed dominant. Hallmarks: Victorian world + anachronistic steam/clockwork machines — brass, copper, wood, leather; gears, pistons, gauges; airships. The WORLD and its machines are the subject. NOT pure Victorian costume/portraiture, NOT gears glued onto modern scenes, NOT generic vintage industrial.",
};

export const QUALITY_BAR = "Also reject, whatever the genre: watermark or logo overlays (a small corner artist signature is fine), garbled or gibberish text, visible AI artifacts (mangled hands/faces, waxy skin), presentation boards / design sheets / multi-panel layouts, unfinished grey blockouts, murky or blurry images, and recognizable trademarked or IP characters.";

// Strong genre vocabulary for the live feed's metadata pre-pass: when a
// candidate's own generation prompt (Civitai meta) or its model's name
// carries enough of this vocabulary, the genre intent is explicit and the
// piece passes without spending a vision call. Weak or absent metadata
// still goes to the vision gate.
export const AFFINITY = {
  "surreal": ["surreal", "dreamscape", "dreamlike", "levitating", "melting clock", "dali", "magritte", "uncanny", "liminal", "backrooms", "biomorphic", "floating island", "impossible geometry"],
  "art-deco": ["art deco", "gatsby", "chevron", "sunburst", "zigzag", "1920s", "flapper", "chrysler building", "jazz age", "decadence"],
  "art-moderne": ["streamline moderne", "art moderne", "streamlined", "bauhaus", "dieselpunk", "ocean liner", "porthole", "streamline"],
  "mid-century": ["mid century", "mid-century", "midcentury", "atomic age", "eames", "teak", "retro futurism", "1950s interior", "1960s interior"],
  "pop": ["pop art", "warhol", "lichtenstein", "ben-day", "benday", "comic book", "screen print", "halftone", "pop culture"],
  "afrofuturism": ["afrofuturism", "afrofuturist", "afro futurism", "wakanda", "african futurism", "ankara", "nubian", "kemet"],
  "brutalist": ["brutalist", "brutalism", "beton brut", "raw concrete", "monolithic concrete", "concrete architecture"],
  "cyberpunk": ["cyberpunk", "neon city", "blade runner", "neon noir", "augmented", "dystopian city", "cyber city", "neon rain"],
  "film-noir": ["film noir", "noir style", "chiaroscuro", "venetian blind", "femme fatale", "hardboiled", "detective office", "noir lighting"],
  "gothic": ["gothic", "cathedral", "pointed arch", "flying buttress", "gargoyle", "stained glass", "rib vault", "spires"],
  "minimalist": ["minimalist", "minimalism", "negative space", "geometric abstraction", "monochrome geometry", "minimal architecture"],
  "solarpunk": ["solarpunk", "solar punk", "green architecture", "vertical forest", "green roof", "solar panels", "eco futurism", "ecofuturism", "lush city"],
  "steampunk": ["steampunk", "steam punk", "clockwork", "airship", "brass gears", "victorian machine", "zeppelin", "automaton"],
};

// Per-lane genre subsets (v64, Andres's direction): each grouping carries
// only the genres that genuinely produce that subject, so a lane never
// offers a style that doesn't belong to it. The movement index shows the
// current lane's subset, the locked strip hides groupings where the genre
// isn't carried, and the home river only decks subset genres per lane
// (the rest bank to their genre columns as usual).
export const LANE_GENRES = {
  "design": ["pop", "art-deco", "art-moderne", "mid-century", "cyberpunk", "brutalist", "minimalist", "film-noir", "surreal", "afrofuturism"],
  "world": ["surreal", "solarpunk", "cyberpunk", "afrofuturism", "steampunk", "gothic", "brutalist", "art-deco", "art-moderne", "mid-century", "film-noir", "minimalist"],
  "architecture": ["art-deco", "art-moderne", "mid-century", "brutalist", "gothic", "solarpunk", "cyberpunk", "steampunk", "minimalist", "afrofuturism", "surreal", "film-noir"],
  "character": ["afrofuturism", "cyberpunk", "steampunk", "gothic", "film-noir", "pop", "surreal", "art-deco", "mid-century", "solarpunk"],
  "prop": ["steampunk", "mid-century", "art-deco", "art-moderne", "cyberpunk", "pop", "minimalist", "film-noir", "afrofuturism", "surreal", "gothic", "solarpunk"],
};
