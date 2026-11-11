// INSPOBOX — seed feed + concept atoms. Served only to signed-in accounts
// via functions/api/inspobox/data.js. Feed imagery is generated cover art
// living in inspobox/img/ (public files, like Jollywood's photos); the
// curation and the idea banks live here, behind the gate.

export const MOVEMENTS = [
  { id: "surreal", name: "Surreal", tag: "Logic, off duty", img: "/inspobox/img/surreal.webp" },
  { id: "cozy", name: "Cozy", tag: "Warmth as a genre", img: "/inspobox/img/cozy.webp" },
  { id: "minimalist", name: "Minimalist", tag: "Nothing extra", img: "/inspobox/img/minimalist.webp" },
  { id: "art-deco", name: "Art Deco", tag: "Gilded geometry", img: "/inspobox/img/artdeco.webp" },
  { id: "grecofuturist", name: "Grecofuturist", tag: "Marble meets orbit", img: "/inspobox/img/grecofuturist.webp" },
  { id: "cyberpunk", name: "Cyberpunk", tag: "High tech, low light", img: "/inspobox/img/cyberpunk.webp" },
  { id: "solarpunk", name: "Solarpunk", tag: "The future, garden-kept", img: "/inspobox/img/solarpunk.webp" },
  { id: "steampunk", name: "Steampunk", tag: "Brass & steam", img: "/inspobox/img/steampunk-photo.webp" },
];

export const MEDIA = [
  { id: "camerawork", name: "Camerawork" },
  { id: "architecture", name: "Architecture" },
  { id: "photography", name: "Photography" },
  { id: "design", name: "Design" },
  { id: "ui", name: "UI" },
];

export const FEED = [
  { id: "f01", movement: "cyberpunk", media: "photography", title: "NEON DISTRICT, RAIN STUDY Nº 7", by: "Medium format · f/1.4 · anamorphic flare", img: "/inspobox/img/cyberpunk.webp" },
  { id: "f02", movement: "cyberpunk", media: "camerawork", title: "MARKET RUN, MIDNIGHT", by: "Tracking shot · rider sharp, city smeared · practical neon only", img: "/inspobox/img/cyberpunk-cam.webp" },
  { id: "f03", movement: "art-deco", media: "architecture", title: "THE AVALON TOWER", by: "Straight up · black & gold · 1931 bones, 2026 light", img: "/inspobox/img/artdeco.webp" },
  { id: "f04", movement: "art-deco", media: "design", title: "SUNBURST OVER THE GRID", by: "Gilded stage set · one red searchlight · no CGI", img: "/inspobox/img/deco-design.webp" },
  { id: "f05", movement: "surreal", media: "photography", title: "RED HOUR OVER THE SALT FLAT", by: "One balloon, one horizon · shot as found", img: "/inspobox/img/surreal.webp" },
  { id: "f06", movement: "surreal", media: "design", title: "STAIRCASE, MELTING", by: "Impossible architecture · poster study in violet", img: "/inspobox/img/surreal-design.webp" },
  { id: "f07", movement: "solarpunk", media: "architecture", title: "THE VERDANT STACK", by: "Terraced gardens · solar petals · golden hour", img: "/inspobox/img/solarpunk.webp" },
  { id: "f08", movement: "steampunk", media: "camerawork", title: "THE ROOFTOP CINEMATOGRAPH", by: "Brass & mahogany · hand-cranked at dusk", img: "/inspobox/img/steampunk-cam.webp" },
  { id: "f09", movement: "steampunk", media: "photography", title: "LAST DOCKING AT DUSK", by: "Gaslight & copper · shot from the rigging", img: "/inspobox/img/steampunk-photo.webp" },
  { id: "f10", movement: "cozy", media: "photography", title: "RAINY SEASON, WINDOW SEAT", by: "Available light · one cat, asleep", img: "/inspobox/img/cozy.webp" },
  { id: "f11", movement: "cozy", media: "camerawork", title: "HEARTH, WITH EVERYONE HOME", by: "Fireplace light · gentle grain · three generations", img: "/inspobox/img/cozy-cam.webp" },
  { id: "f12", movement: "minimalist", media: "design", title: "ONE RED CIRCLE", by: "A sculpture, a stranger, nothing else", img: "/inspobox/img/minimalist.webp" },
  { id: "f13", movement: "minimalist", media: "ui", title: "SIGNAL, NOT NOISE", by: "One action per screen · frosted glass study", img: "/inspobox/img/minimalist-ui.webp" },
  { id: "f14", movement: "grecofuturist", media: "architecture", title: "TEMPLE OF THE NEW DAWN", by: "Marble & chrome · laurel, standard issue", img: "/inspobox/img/grecofuturist.webp" },
];

// ---- Idea Starter atoms -------------------------------------------------
// The generator crosses up to two sources (movements, or Disney). With a
// prompt, the prompt is the seed and the atoms dress it; without one, a
// subject is drawn from the crossed packs.

export const ATOMS = {
  formats: [
    { kind: "VIDEO", label: "15S VERTICAL" },
    { kind: "VIDEO", label: "60S SHORT" },
    { kind: "VIDEO", label: "ONE-TAKE SCENE" },
    { kind: "PHOTO", label: "HERO FRAME" },
    { kind: "PHOTO", label: "SERIES OF FIVE" },
    { kind: "DESIGN", label: "KEY ART / POSTER" },
  ],
  subjects: [
    "a night-shift lighthouse keeper who collects other people's dreams",
    "a chess grandmaster playing against a haunted arcade cabinet",
    "a florist who only works at night",
    "the last projectionist in a city of streaming",
    "a street musician whose instrument is a building",
    "a cartographer mapping neighborhoods that don't exist yet",
    "a deep-sea welder repairing a cathedral on the ocean floor",
    "a retired getaway driver who now runs a food truck",
    "a beekeeper keeping hives on the roof of a skyscraper",
    "a tailor who sews pockets for carrying weather",
    "an elevator operator in a hotel with a thousand floors",
    "a sign painter painting signs for businesses from the future",
  ],
  settings: [
    "a flooded art museum at blue hour",
    "a night market built inside a decommissioned airliner",
    "a greenhouse monorail crossing a desert",
    "a library where the books rearrange themselves at closing",
    "a rooftop observatory above a sleeping city",
    "a ferry terminal frozen mid-departure in 1962",
    "a canyon town that only appears during eclipses",
    "a ballroom on the last floor of a sinking hotel",
  ],
  shots: [
    "Slow push-in through steam, ending on a single practical light",
    "One unbroken orbit — the camera never stops moving",
    "Locked-off wide; all the motion happens in reflections",
    "Handheld chase that keeps losing the subject, on purpose",
    "Top-down tabletop world, shot like a satellite survey",
    "Split-diopter diptych: foreground tiny, background monumental",
    "Whip-pan transitions stitched to look like a single take",
    "Extreme macro opens the scene; pull back to reveal the impossible scale",
  ],
  lights: [
    "one red neon sign and whatever it touches",
    "golden hour stretched to last the whole scene",
    "candlelight and lightning, alternating beats",
    "harsh noon sun, shadows like cut paper",
    "bioluminescent glow rising from below frame",
    "black-and-white world, a single color kept",
  ],
  twists: [
    "Every object opens in reverse — time runs backwards",
    "The narrator is the setting, and it has opinions",
    "The final frame is the first frame, changed by one detail",
    "Gravity is negotiable and everyone is polite about it",
    "It is shot as a nature documentary about humans",
    "The soundtrack is performed live by the subject",
    "Each scene rhymes with the one before it",
    "The camera is a character nobody acknowledges",
  ],
  titleAdj: ["VELVET", "HOLLOW", "STATIC", "GILDED", "FERAL", "LUCID", "SCARLET", "QUIET", "ELECTRIC", "PAPER"],
  titleNoun: ["HOUR", "GARDEN", "SIGNAL", "HARBOUR", "CIRCUIT", "ORCHARD", "MACHINE", "CARTOGRAPHER", "SEASON", "RELAY"],
  flavor: {
    surreal: {
      adj: ["MELTING", "INVERTED", "WEIGHTLESS"],
      subjects: ["a doorman holding doors for rooms that aren't there", "a flock of umbrellas migrating for winter", "a staircase salesman demonstrating infinity"],
      settings: ["a desert where it rains upward", "an office where the furniture is slowly drifting apart", "a beach at low tide inside a cathedral"],
      shots: ["Impossible dolly: through a keyhole, out of a mouth", "Mirror shot where the reflection moves first"],
      twists: ["Every shadow belongs to a different object", "The horizon is negotiable — it keeps being renegotiated"],
      nouns: ["STAIRCASE", "HORIZON", "UMBRELLA"],
    },
    cozy: {
      adj: ["FIRESIDE", "WOOLLEN", "HONEYED"],
      subjects: ["a grandmother teaching the house to bake", "a night baker who leaves loaves on strangers' steps", "a librarian who knits bookmarks into every returned book"],
      settings: ["a cabin kitchen during the first snow", "a bookshop flat above the shop, kettle always on", "a train compartment crossing a winter valley at dusk"],
      shots: ["Slow lateral drift past windows glowing one by one", "Overhead breakfast-table choreography, steam in every frame"],
      twists: ["Nothing goes wrong; the tension is whether the tea stays warm", "Every scene ends one second before a hug"],
      nouns: ["KETTLE", "HEARTH", "MITTEN"],
    },
    minimalist: {
      adj: ["SINGLE", "UNBROKEN", "BARE"],
      subjects: ["one figure crossing an empty plane", "a keeper of a single red object", "a performer who does almost nothing, perfectly"],
      settings: ["a white void with one horizon line", "an empty car park at dawn, one painted stripe", "a room with a chair, a window, and time"],
      shots: ["One static frame; composition does all the talking", "A single slow zoom across the entire piece"],
      twists: ["The boldest event is a color arriving", "Sound design carries what the image refuses to"],
      nouns: ["LINE", "CIRCLE", "PAUSE"],
    },
    "art-deco": {
      adj: ["GILDED", "JAZZ-AGE", "SUNBURST"],
      subjects: ["a elevator operator in a hotel of impossible glamour", "a radio siren broadcasting from a zeppelin lounge", "a jewel thief who only steals spotlights"],
      settings: ["a grand hotel lobby at the stroke of midnight, 1931", "a transatlantic liner's ballroom in a storm", "a penthouse radio studio above a neon avenue"],
      shots: ["Symmetrical crane moves, geometry worshipped", "Silhouette procession against a sunburst backdrop"],
      twists: ["Every transition is a match-cut on a geometric shape", "The whole piece is choreographed to a single foxtrot"],
      nouns: ["SUNBURST", "ZIGGURAT", "FOXTROT"],
    },
    grecofuturist: {
      adj: ["LAURELED", "ORBITAL", "MARBLE"],
      subjects: ["an oracle who reads satellite telemetry like entrails", "a marathon runner carrying fire between space stations", "a sculptor carving statues of people not yet born"],
      settings: ["a temple portico on a terraformed Aegean coast", "an academy where athletes train in low gravity", "a forum rebuilt as a launch complex"],
      shots: ["Low heroic angles, columns and contrails in one frame", "Processional tracking shots, banners and boosters"],
      twists: ["The gods have mission control now, and they argue about telemetry", "Every victory lap is also an orbit"],
      nouns: ["LAUREL", "ORBIT", "COLUMN"],
    },
    cyberpunk: {
      adj: ["NEON", "CHROME", "STATIC-BORN"],
      subjects: ["a courier who delivers memories in person", "a hacker farming black-market rain", "a street chef cooking with decommissioned server heat"],
      settings: ["a night market stacked forty floors high", "a flooded district lit by billboards", "a capsule hotel for retired androids"],
      shots: ["Anamorphic streaks; focus breathes like it's nervous", "Drone dive through signage canyons"],
      twists: ["The city's AI is in love with one traffic light", "Every screen in frame is watching back"],
      nouns: ["SIGNAL", "DISTRICT", "RAIN"],
    },
    solarpunk: {
      adj: ["VERDANT", "SUNWARD", "COMMONS"],
      subjects: ["a seed librarian lending extinct flowers", "an engineer who maintains a river like a relative", "a choir that sings the weather forecast at dawn"],
      settings: ["a neighborhood that rebuilt itself as a garden", "a solar zeppelin farm above terraced hills", "a market square shaded by living canopies"],
      shots: ["Crane rises through leaves into open sun", "Hands-first documentary: everything is being tended"],
      twists: ["The conflict is a drought, and the weapon is a festival", "Technology appears only when it is beautiful enough"],
      nouns: ["CANOPY", "COMMONS", "BLOOM"],
    },
    steampunk: {
      adj: ["BRASSBOUND", "COAL-FIRED", "GILDED-GEAR"],
      subjects: ["an airship cartographer charting unclaimed skies", "a clockmaker who repairs memories with tweezers", "a railway baroness racing her own locomotive"],
      settings: ["a rooftop dock above a gaslit city", "a grand exchange where time is the currency", "a submersible tea room under the Thames"],
      shots: ["Hand-cranked variable speed; the frame breathes steam", "Gears in macro open every scene like punctuation"],
      twists: ["The machine works perfectly; it's the paperwork that's haunted", "Every invention solves the previous invention's problem"],
      nouns: ["AIRSHIP", "ESCAPEMENT", "BOILER"],
    },
  },
};

// ---- Disney pack ----------------------------------------------------------
// A crossable source of its own: pick Disney, then a studio. Atoms are
// archetypes, worlds and formats from across the studios — built for
// remixing into original concepts.

export const DISNEY = {
  studios: [
    { id: "animation", name: "Animation" },
    { id: "pixar", name: "Pixar" },
    { id: "marvel", name: "Marvel" },
    { id: "starwars", name: "Star Wars" },
    { id: "parks", name: "Parks" },
    { id: "liveaction", name: "Live-Action" },
  ],
  shots: [
    "Storybook opening: the camera pushes into a living illustration",
    "A 'how it works' montage — the world explained by its machinery",
    "One perfect silhouette held against a painted sky",
    "Sidekick-cam: the world at knee height, twice as fast",
    "A musical-number camera — it dances, it doesn't follow",
    "The wide reveal: pull back until the whole impossible place fits",
  ],
  lights: [
    "fireworks timing — every beat lands on a burst",
    "lantern-light and the blue hour after it",
    "pure Technicolor saturation, shadows kept gentle",
    "a single spotlight in a dark theater of a world",
  ],
  titleAdj: ["ONCE-UPON", "SECOND-STAR", "WONDER", "LANTERN", "EVER", "SMALL-WORLD"],
  titleNoun: ["TIME", "WISH", "PARADE", "HARBOUR", "KINGDOM", "SPARK"],
  packs: {
    animation: {
      subjects: ["a sidekick applying for a promotion to hero", "the castle's night staff, after the last guest leaves", "a lost song looking for its movie"],
      settings: ["a kingdom where every law is a musical cue", "a forest clearing that hosts a nightly animal parliament", "a tower library where the books are spells with opinions"],
      twists: ["The villain's song is the best one and everyone knows it", "The transformation sequence is a union job with paperwork"],
    },
    pixar: {
      subjects: ["a feelings-for-hire temp agency inside a very ordinary head", "the monster who is terrified of the child", "a lamp's retirement, told in objects"],
      settings: ["the memory archives at the end of a long childhood", "a city built entirely from found objects", "the after-hours world inside a family restaurant"],
      twists: ["The macguffin is a core memory and it is mislabeled", "It is a buddy comedy about a process, and the process is grief"],
    },
    marvel: {
      subjects: ["a hero's very normal day off, ruined politely", "the cleanup crew that arrives after the third-act battle", "a villain's origin told as a cooking show"],
      settings: ["a support group for reformed henchmen", "the one city block that has been destroyed six times", "a shield-grade safehouse run like a bed & breakfast"],
      twists: ["The post-credits scene is the actual plot", "Powers are inherited, and so is the therapy bill"],
    },
    starwars: {
      subjects: ["a droid with a collections hobby and a debt problem", "the cantina's house band negotiating a record deal", "a moisture farmer who wins the lottery and hates it"],
      settings: ["the last video-rental store in the galaxy", "a repair shop at the edge of a junkyard planet", "a diplomatic summit hosted on a retired star destroyer"],
      twists: ["The Force is strong in the paperwork", "It is a western; the saloon is a docking bay"],
    },
    parks: {
      subjects: ["a forgotten attraction animatronic learning new dances", "the night crew that repaints the magic before dawn", "a balloon seller who has heard every wish for forty years"],
      settings: ["the utilidor city beneath the kingdom at 4 AM", "a parade float warehouse where the floats dream", "the last empty land, the night before it opens"],
      twists: ["The ride is sentient and it has notes on the script", "Every guest wish is archived, and one just expired"],
    },
    liveaction: {
      subjects: ["a very Mary-sensible nanny assigned to a house of tiny chaos agents", "the understudy who knows every role in the building", "a bookshop owner whose shop keeps casting spells by accident"],
      settings: ["a London rooftop at chimney-sweep hour", "a small-town main street that refuses to be modernized", "a boarding house where every tenant is hiding a talent"],
      twists: ["The practical effect is real and nobody will say how", "It ends with a parade; it always ends with a parade"],
    },
  },
};
