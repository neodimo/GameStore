export type LinkState = "verified" | "unverified" | "stale" | "dead";
export type Game = {
  id: string;
  title: string;
  year: number;
  region: "USA" | "Europe" | "Japan";
  genres: string[];
  facets: string[];
  description: string;
  curatorNote?: string;
  descriptionSource?: { label: string; url: string };
  cover?: string;
  /**
   * No-Intro release name this game's artwork is published under. Lets the
   * runtime resolver hit the thumbnail index by lookup instead of scoring the
   * whole index; fuzzy matching is the fallback for titles without one.
   */
  coverName?: string;
  screenshots?: string[];
  video?: string;
  players: string;
  developer: string;
  publisher?: string;
  esrb?: string;
  rating?: { source: string; score: number; count?: number };
  translation?: { team: string; status: string; url: string; base: string };
  links: { label: string; url: string; state: LinkState }[];
};
/**
 * Seed filenames only. Artwork is resolved at runtime by fuzzy-matching the
 * live Libretro thumbnail index (see `artMatch.ts`); these values are the
 * offline fallback for the web build, which cannot fetch that index.
 */
const lib = (name: string) =>
  `https://thumbnails.libretro.com/Sony%20-%20PlayStation/Named_Boxarts/${encodeURIComponent(name)}.png`;
const yt = (id: string) => `https://www.youtube.com/embed/${id}`;
const wiki = (q: string) =>
  `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q)}`;
/**
 * Search term for a translation lookup, derived from the catalog title.
 *
 * These queries used to be hand-written per record, and drifted: `Baroque`
 * searched for "Baroque PS1" (a platform tag no database title contains),
 * `Kowloon’s Gate` searched "Kowloon Gate", `Linda³ Again` searched "Linda Cube
 * Again". Deriving from the title makes drift impossible.
 *
 * The term is reduced to the leading segment because a romhacking entry is
 * indexed under the short release name: searching the full "Germs: Nerawareta
 * Machi" returns nothing, while "Germs" finds it. A shorter term over-matches,
 * which is recoverable by eye; an over-specific one silently returns nothing.
 */
export const translationSearchTerm = (title: string) =>
  title
    .replace(/[³]/g, "3")
    .replace(/[²]/g, "2")
    .replace(/[’‘]/g, "'")
    .split(/\s*[:—–]\s*|\s+-\s+/)[0]
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
/**
 * ROMhacking.net currently delegates site search to Google. Keep this URL in
 * the same shape as the site's own search form so a catalog lookup follows the
 * path users already know works instead of relying on the retired internal
 * `?page=translations&search=` endpoint.
 */
export const translationSearchUrl = (q: string) =>
  `https://www.google.com/search?q=${encodeURIComponent(q)}&btnG=Search&sitesearch=www.romhacking.net`;
const retroGameTalk = (q: string) =>
  `https://retrogametalk.com/repo/?s=${encodeURIComponent(q)}`;
/**
 * Which disc a fan patch applies to, taken from the translation manifest.
 *
 * These serials used to be hand-written beside each record and were wrong in
 * ways nothing could catch: `Tobal No. 2` claimed SLPS-01025, which Redump
 * lists as *Dare Devil Derby 3D*, and `Linda³ Again` claimed SCPS-45124, which
 * Redump does not list at all. The manifest's serials are checked against the
 * Redump DAT by `scripts/import-redump-targets.py`, so deriving the value from
 * there makes that class of drift impossible — the same reason the search term
 * above is derived from the title rather than typed out per record.
 */
const translationBase = (gameId: string) => {
  const record = translationManifest.find((entry) => entry.gameId === gameId);
  return record ? `${record.target.release} (${record.target.serial})` : "Release not yet identified";
};
const g = (
  id: string,
  title: string,
  year: number,
  region: Game["region"],
  genres: string[],
  facets: string[],
  description: string,
  note: string,
  players = "1",
  developer = "Various",
  coverName?: string,
  video?: string,
  // `url` is derived from the title unless a record supplies a verified one;
  // `base` is derived from the translation manifest, never written here.
  translation?: Omit<NonNullable<Game["translation"]>, "url" | "base"> & { url?: string },
): Game => {
  const resolvedTranslation: Game["translation"] = translation && {
    ...translation,
    url: translation.url ?? translationSearchUrl(translationSearchTerm(title)),
    base: translationBase(id),
  };
  return {
    id,
    title,
    year,
    region,
    genres,
    facets,
    description,
    curatorNote: note,
    players,
    developer,
    cover: coverName ? lib(coverName) : undefined,
    coverName,
    video: video ? yt(video) : undefined,
    translation: resolvedTranslation,
    rating: undefined,
    links: [
      { label: "Game reference", url: wiki(title), state: "verified" },
      {
        label: "Search RetroGameTalk",
        url: retroGameTalk(title),
        state: "unverified",
      },
      ...(resolvedTranslation
        ? [
            {
              label: "Find translation patch",
              url: resolvedTranslation.url,
              state: "unverified" as LinkState,
            },
          ]
        : []),
    ],
  };
};

const coreGames: Game[] = [
  g(
    "incredible-crisis",
    "Incredible Crisis",
    2000,
    "USA",
    ["Action", "Minigame"],
    ["Frantic comedy", "Bizarre premise"],
    "A family attempts to reach grandma’s birthday while dancing, fleeing boulders, surviving bank robberies, and meeting aliens.",
    "A mundane errand mutates into a delirious game-show catastrophe.",
    "1",
    "Polygon Magic",
    "Incredible Crisis (USA)",
    "JmL-47bMyjY",
  ),
  g(
    "mr-domino",
    "No One Can Stop Mr. Domino!",
    1998,
    "USA",
    ["Puzzle", "Action"],
    ["Experimental controls", "Bizarre premise"],
    "Lay dominoes around looping household courses, then trigger elaborate environmental chain reactions.",
    "Domino toppling treated with the gravity of an extreme sport.",
    "1",
    "Artdink",
    "No One Can Stop Mr. Domino! (USA)",
  ),
  g(
    "vib-ribbon",
    "Vib-Ribbon",
    2000,
    "Europe",
    ["Rhythm"],
    ["Minimalist", "Experimental controls"],
    "Guide a wireframe rabbit through rhythm obstacles, including levels generated from your own audio CDs.",
    "A black-and-white music visualizer escaped and became a perfect arcade game.",
    "1",
    "NanaOn-Sha",
    "Vib-Ribbon (Europe)",
  ),
  g(
    "tail-sun",
    "Tail of the Sun",
    1997,
    "USA",
    ["Adventure", "Simulation"],
    ["Surreal", "Outsider art"],
    "Lead sleepy cavemen across a huge prehistoric landscape, gathering food and mammoth tusks to build a tower to the sun.",
    "Its systems feel half anthropology, half dream logic.",
    "1",
    "Artdink",
    "Tail of the Sun (USA)",
  ),
  g(
    "rising-zan",
    "Rising Zan: The Samurai Gunman",
    1999,
    "USA",
    ["Action"],
    ["Camp", "Genre collision"],
    "A swaggering cowboy samurai slices robot ninjas, plays guitar, and poses his way through tokusatsu chaos.",
    "It commits to its stupid brilliance with magnificent confidence.",
    "1",
    "UEP Systems",
    "Rising Zan - The Samurai Gunman (USA)",
  ),
  g(
    "irritating-stick",
    "Irritating Stick",
    1999,
    "USA",
    ["Puzzle"],
    ["Strange peripheral", "Experimental controls"],
    "Guide a stick through electrified mazes without touching the walls while a host narrates your failure.",
    "A steady-hand carnival game engineered into concentrated anxiety.",
    "1-2",
    "Saurus",
    "Irritating Stick (USA)",
  ),
  g(
    "one-piece-mansion",
    "One Piece Mansion",
    2001,
    "USA",
    ["Puzzle", "Simulation"],
    ["Bizarre premise"],
    "Manage an apartment building where every tenant’s happiness affects neighboring rooms.",
    "Landlordship reimagined as a spatial emotional-pressure puzzle.",
    "1",
    "Capcom",
    "One Piece Mansion (USA)",
  ),
  g(
    "devil-dice",
    "Devil Dice",
    1998,
    "USA",
    ["Puzzle"],
    ["Bizarre premise"],
    "Tiny devils sprint across giant dice, rolling matching faces together before the board overwhelms them.",
    "A sharp puzzle design wearing a wonderfully unhelpful demonic costume.",
    "1-5",
    "Shift",
    "Devil Dice (USA)",
  ),
  g(
    "team-buddies",
    "Team Buddies",
    2000,
    "Europe",
    ["Strategy", "Action"],
    ["Camp", "Genre collision"],
    "Stack supply crates to manufacture foul-mouthed blob soldiers, weapons, and vehicles.",
    "Toybox tactics with the vocabulary of a particularly rude pub.",
    "1-4",
    "Psygnosis",
    "Team Buddies (Europe)",
  ),
  g(
    "unholy-war",
    "The Unholy War",
    1998,
    "USA",
    ["Fighting", "Strategy"],
    ["Genre collision", "Mascot nightmare"],
    "Arena combat and turn-based strategy collide with a bomb monkey, giant tick, and psychic war machines.",
    "A roster assembled by tipping an entire sketchbook down the stairs.",
    "1-2",
    "Toys for Bob",
    "Unholy War, The (USA)",
  ),
  g(
    "poy-poy",
    "Poy Poy",
    1997,
    "USA",
    ["Action", "Party"],
    ["Frantic comedy"],
    "Cute contestants hurl rocks, logs, missiles, and scenery at one another in compact arenas.",
    "Four-player friendship demolition in its purest 32-bit form.",
    "1-4",
    "Konami",
    "Poy Poy (USA)",
  ),
  g(
    "eggs-steel",
    "Eggs of Steel",
    1998,
    "USA",
    ["Platformer"],
    ["Bizarre premise", "Mascot nightmare"],
    "A walking egg explores a steel mill using deliberately weighty, awkward movement.",
    "Industrial labor has never been so ovular.",
    "1",
    "Rhino Studios",
    "Eggs of Steel - Charlie's Eggcellent Adventure (USA)",
  ),
  g(
    "boombots",
    "BoomBots",
    1999,
    "USA",
    ["Fighting"],
    ["Camp", "Outsider art"],
    "A claymation brawler starring an Elvis alien, a fighting chicken, and rejected action figures.",
    "The Neverhood’s mutant cousin picks a fight in a parking lot.",
    "1-2",
    "The Neverhood",
    "BoomBots (USA)",
  ),
  g(
    "harmful-park",
    "Harmful Park",
    1997,
    "Japan",
    ["Shooter"],
    ["Cute horror", "Bizarre premise"],
    "A bright cute-em-up firing pie, ice cream, and jelly through a weaponized amusement park.",
    "Dessert artillery makes the apocalypse look adorable.",
    "1-2",
    "Sky Think System",
    undefined,
    undefined,
    {
      team: "LIPEMCO! Translations",
      status: "Complete",
    },
  ),
  g(
    "planet-laika",
    "Planet Laika",
    1999,
    "Japan",
    ["RPG"],
    ["Surreal", "Experimental RPG"],
    "A dog-headed colony on Mars is navigated through three personalities with different psychic powers.",
    "A psychology textbook processed through a canine fever dream.",
    "1",
    "Quintet",
    undefined,
    undefined,
    {
      team: "Fan translation",
      status: "Complete",
    },
  ),
  g(
    "racing-lagoon",
    "Racing Lagoon",
    1999,
    "Japan",
    ["Racing", "RPG"],
    ["Genre collision", "Camp"],
    "Square’s street-racing RPG turns night driving into operatic melodrama and car-part progression.",
    "Every gear change feels like a forbidden monologue.",
    "1",
    "Square",
    undefined,
    undefined,
    {
      team: "Hilltop Works",
      status: "Complete",
    },
  ),
  g(
    "mizzurna-falls",
    "Mizzurna Falls",
    1998,
    "Japan",
    ["Adventure"],
    ["Uncanny", "Experimental controls"],
    "An ambitious open-town mystery follows a missing girl through a snowy small town with a living schedule.",
    "Twin Peaks energy inside hardware that can barely contain the town.",
    "1",
    "Human Entertainment",
    undefined,
    undefined,
    {
      team: "Fan translation",
      status: "Complete",
    },
  ),
  g(
    "paranoiascape",
    "ParanoiaScape",
    1998,
    "Japan",
    ["Pinball", "Horror"],
    ["Genre collision", "Outsider art"],
    "Screaming Mad George turns first-person pinball into a biomechanical horror tunnel.",
    "Horror pinball: two words that should have met much sooner.",
    "1",
    "Jorudan",
    undefined,
    undefined,
    {
      team: "Aeon Genesis",
      status: "Complete",
    },
  ),
  g(
    "baroque",
    "Baroque",
    1999,
    "Japan",
    ["RPG", "Roguelike"],
    ["Surreal", "Body horror"],
    "Descend a mutating tower where death, guilt, angels, and distorted flesh form the progression loop.",
    "A bleak roguelike whose lore seems to resent being understood.",
    "1",
    "Sting",
    undefined,
    undefined,
    {
      team: "Fan translation",
      status: "Complete",
    },
  ),
  g(
    "remote-control-dandy",
    "Remote Control Dandy",
    1999,
    "Japan",
    ["Action", "Simulation"],
    ["Experimental controls", "Bizarre premise"],
    "Control a giant robot from a human-scale viewpoint with intentionally cumbersome limb inputs.",
    "The buildings are fragile and your controller is basically a forklift license.",
    "1",
    "Human Entertainment",
    undefined,
    undefined,
    {
      team: "Fan translation",
      status: "Complete",
    },
  ),
  g(
    "tobal-2",
    "Tobal No. 2",
    1997,
    "Japan",
    ["Fighting", "RPG"],
    ["Genre collision"],
    "A technical fighter expands into dungeon crawling, monster capture, and a huge Toriyama-designed roster.",
    "A fighting game swallowed an RPG and somehow improved its posture.",
    "1-2",
    "DreamFactory",
    undefined,
    undefined,
    {
      team: "Infinite Lupine",
      status: "Complete",
    },
  ),
  g(
    "germs",
    "Germs: Nerawareta Machi",
    1999,
    "Japan",
    ["RPG", "Horror"],
    ["Uncanny", "Surreal"],
    "A first-person open-town RPG investigates alien parasites in a city collapsing into low-poly nightmare.",
    "It feels like the PS1 itself caught an infection.",
    "1",
    "Koei",
    undefined,
    undefined,
    {
      team: "Fan translation",
      status: "Complete",
    },
  ),
  g(
    "kowloons-gate",
    "Kowloon’s Gate",
    1997,
    "Japan",
    ["Adventure"],
    ["Surreal", "Uncanny"],
    "Explore an Asian-gothic cyberpunk maze of cursed architecture, displaced objects, and impossible neighborhoods.",
    "A pre-rendered city dreams that you are trespassing.",
    "1",
    "Zeque",
    undefined,
    undefined,
    {
      team: "Hilltop / Cargodin / EsperKnight",
      status: "Complete",
    },
  ),
  g(
    "linda-cube",
    "Linda³ Again",
    1997,
    "Japan",
    ["RPG"],
    ["Surreal", "Dark comedy"],
    "Capture animals before an apocalypse while three scenarios veer through cloning, murder, and black comedy.",
    "Pokémon’s deeply alarming aunt arrives with an evacuation plan.",
    "1",
    "Alfa System",
    undefined,
    undefined,
    {
      team: "Fan translation",
      status: "Complete",
    },
  ),
  g(
    "ore-no-ryouri",
    "Ore no Ryouri",
    1999,
    "Japan",
    ["Simulation", "Action"],
    ["Experimental controls", "Frantic comedy"],
    "Use both analog sticks to chop, fry, pour, wash dishes, and repel restaurant disasters.",
    "The finest cooking game ever made by people who hate calm wrists.",
    "1-2",
    "SCEI",
    undefined,
    undefined,
    {
      team: "Hilltop Works",
      status: "Complete",
    },
  ),
  g(
    "pepsiman",
    "Pepsiman",
    1999,
    "Japan",
    ["Action"],
    ["Camp", "Mascot nightmare"],
    "Pepsi’s chrome superhero runs through traffic and catastrophe between live-action soda interludes.",
    "Corporate advertising achieves outsider-art transcendence.",
    "1",
    "KID",
  ),
  g(
    "cho-aniki",
    "Cho Aniki: Kyuukyoku Muteki Ginga Saikyou Otoko",
    1995,
    "Japan",
    ["Shooter"],
    ["Camp", "Body horror"],
    "A shooter powered by flexing bodybuilders, flying heads, protein, and interstellar posing.",
    "A funding decision no committee will ever successfully reconstruct.",
    "1-2",
    "NCS",
  ),
  g(
    "mad-panic-coaster",
    "Mad Panic Coaster",
    1997,
    "Japan",
    ["Shooter", "Action"],
    ["Frantic comedy", "Bizarre premise"],
    "Ride a roller coaster through monsters and hazards while shooting and dodging at absurd speed.",
    "A haunted dark ride tears loose from the amusement park.",
    "1",
    "Hakuhodo",
  ),
  g(
    "internal-section",
    "Internal Section",
    1999,
    "Japan",
    ["Shooter", "Rhythm"],
    ["Surreal", "Minimalist"],
    "A psychedelic tube shooter dives through abstract wireframe spaces synchronized to electronic music.",
    "Rez’s strange PS1 ancestor, recovered from a laser-lit hard drive.",
    "1",
    "Square",
  ),
  g(
    "slap-happy",
    "Slap Happy Rhythm Busters",
    2000,
    "Japan",
    ["Fighting", "Rhythm"],
    ["Genre collision", "Camp"],
    "Cel-shaded street fighters trigger rhythm-button supers over a superb electronic soundtrack.",
    "A club flyer became a fighting game and refused to sober up.",
    "1-2",
    "Polygon Magic",
  ),
];

type BroaderSeed = [string, string, number, Game["region"], string[], string, string];
const broaderSeeds: BroaderSeed[] = [
  ["castlevania-sotn", "Castlevania: Symphony of the Night", 1997, "USA", ["Action", "RPG"], "Explore Dracula's inverted castle in a lavish nonlinear action RPG.", "Castlevania - Symphony of the Night (USA)"],
  ["metal-gear-solid", "Metal Gear Solid", 1998, "USA", ["Stealth", "Action"], "Sneak through Shadow Moses in Kojima's cinematic tactical espionage classic.", "Metal Gear Solid (USA) (Disc 1)"],
  ["silent-hill", "Silent Hill", 1999, "USA", ["Horror", "Adventure"], "Search a fogbound town where guilt and industrial nightmares bleed together.", "Silent Hill (USA)"],
  ["resident-evil-2", "Resident Evil 2", 1998, "USA", ["Horror", "Adventure"], "Survive a zombie outbreak across Raccoon City's police station.", "Resident Evil 2 (USA) (Disc 1)"],
  ["resident-evil-3", "Resident Evil 3: Nemesis", 1999, "USA", ["Horror", "Action"], "Escape Raccoon City while an unstoppable bioweapon hunts you.", "Resident Evil 3 - Nemesis (USA)"],
  ["parasite-eve", "Parasite Eve", 1998, "USA", ["RPG", "Horror"], "A New York cop confronts mitochondrial body horror in a brisk cinematic RPG.", "Parasite Eve (USA) (Disc 1)"],
  ["parasite-eve-2", "Parasite Eve II", 2000, "USA", ["RPG", "Horror"], "Aya Brea investigates another outbreak through tense survival-RPG combat.", "Parasite Eve II (USA) (Disc 1)"],
  ["final-fantasy-7", "Final Fantasy VII", 1997, "USA", ["RPG"], "A mercenary joins an eco-rebellion and discovers a planetary conspiracy.", "Final Fantasy VII (USA) (Disc 1)"],
  ["final-fantasy-8", "Final Fantasy VIII", 1999, "USA", ["RPG"], "Teen mercenaries, time compression, and an ambitious junction system collide.", "Final Fantasy VIII (USA) (Disc 1)"],
  ["final-fantasy-9", "Final Fantasy IX", 2000, "USA", ["RPG"], "A theatrical fantasy adventure about identity, mortality, and found family.", "Final Fantasy IX (USA) (Disc 1)"],
  ["final-fantasy-tactics", "Final Fantasy Tactics", 1998, "USA", ["Strategy", "RPG"], "Deep tactical battles frame a ruthless political tragedy.", "Final Fantasy Tactics (USA)"],
  ["vagrant-story", "Vagrant Story", 2000, "USA", ["RPG", "Action"], "Investigate the cursed city of Leá Monde through intricate weapon-driven combat.", "Vagrant Story (USA)"],
  ["xenogears", "Xenogears", 1998, "USA", ["RPG"], "Martial arts, giant robots, theology, and fractured psychology in maximalist form.", "Xenogears (USA) (Disc 1)"],
  ["chrono-cross", "Chrono Cross", 2000, "USA", ["RPG"], "Cross parallel worlds in a dreamlike sequel with a vast playable cast.", "Chrono Cross (USA) (Disc 1)"],
  ["suikoden", "Suikoden", 1996, "USA", ["RPG"], "Recruit 108 allies and build a resistance headquarters against an empire.", "Suikoden (USA)"],
  ["suikoden-2", "Suikoden II", 1999, "USA", ["RPG"], "Friendship and civil war anchor one of the system's finest political RPGs.", "Suikoden II (USA)"],
  ["wild-arms", "Wild Arms", 1997, "USA", ["RPG"], "A western-flavored fantasy RPG built around tools, puzzles, and ancient machines.", "Wild Arms (USA)"],
  ["wild-arms-2", "Wild Arms 2", 2000, "USA", ["RPG"], "A tokusatsu-tinged western RPG about heroism and sacrifice.", "Wild Arms 2 (USA) (Disc 1)"],
  ["legend-of-dragoon", "The Legend of Dragoon", 2000, "USA", ["RPG"], "Timing-based attacks and armored transformations power a grand four-disc quest.", "Legend of Dragoon, The (USA) (Disc 1)"],
  ["legend-of-legaia", "Legend of Legaia", 1999, "USA", ["RPG"], "Build martial-arts combos while restoring a world swallowed by monster-filled mist.", "Legend of Legaia (USA)"],
  ["grandia", "Grandia", 1999, "USA", ["RPG"], "A joyous expedition with one of the genre's liveliest battle systems.", "Grandia (USA) (Disc 1)"],
  ["lunar-sssc", "Lunar: Silver Star Story Complete", 1999, "USA", ["RPG"], "A warm, animated coming-of-age quest in deluxe two-disc form.", "Lunar - Silver Star Story Complete (USA) (Disc 1)"],
  ["alundra", "Alundra", 1998, "USA", ["Action", "RPG"], "Enter villagers' dreams in a dark, demanding action adventure.", "Alundra (USA)"],
  ["breath-of-fire-3", "Breath of Fire III", 1998, "USA", ["RPG"], "A dragon child grows up across a colorful, melancholic journey.", "Breath of Fire III (USA)"],
  ["breath-of-fire-4", "Breath of Fire IV", 2000, "USA", ["RPG"], "Two converging journeys unfold through gorgeous sprite work and moral ambiguity.", "Breath of Fire IV (USA)"],
  ["kartia", "Kartia: The Word of Fate", 1998, "USA", ["Strategy", "RPG"], "Create weapons and soldiers from magical cards in a dual-story tactical RPG.", "Kartia - The Word of Fate (USA)"],
  ["jade-cocoon", "Jade Cocoon: Story of the Tamamayu", 1999, "USA", ["RPG"], "Capture and fuse forest creatures in a compact Ghibli-touched RPG.", "Jade Cocoon - Story of the Tamamayu (USA)"],
  ["azure-dreams", "Azure Dreams", 1998, "USA", ["RPG", "Roguelike"], "Raise monsters, climb a shifting tower, and rebuild a desert town.", "Azure Dreams (USA)"],
  ["tomba", "Tomba!", 1998, "USA", ["Platformer", "Adventure"], "A pink-haired feral hero tackles quests across a playful interconnected world.", "Tomba! (USA)"],
  ["tomba-2", "Tomba! 2: The Evil Swine Return", 1999, "USA", ["Platformer", "Adventure"], "The pig-wrestling quest system returns in a lively 2.5D world.", "Tomba! 2 - The Evil Swine Return (USA)"],
  ["klonoa", "Klonoa: Door to Phantomile", 1998, "USA", ["Platformer"], "A breezy 2.5D platformer whose dreamlike story lands with surprising force.", "Klonoa - Door to Phantomile (USA)"],
  ["ape-escape", "Ape Escape", 1999, "USA", ["Platformer", "Action"], "Use both analog sticks and a gadget wheel to recapture time-traveling apes.", "Ape Escape (USA)"],
  ["medievil", "MediEvil", 1998, "USA", ["Action", "Adventure"], "A failed knight gets a second chance in a crooked gothic storybook.", "MediEvil (USA)"],
  ["legacy-of-kain-sr", "Legacy of Kain: Soul Reaver", 1999, "USA", ["Action", "Adventure"], "Shift between material and spectral realms in a ruined vampire kingdom.", "Legacy of Kain - Soul Reaver (USA)"],
  ["oddworld-abe", "Oddworld: Abe's Oddysee", 1997, "USA", ["Platformer", "Puzzle"], "Guide a fragile factory worker through lethal puzzles and corporate satire.", "Oddworld - Abe's Oddysee (USA)"],
  ["oddworld-exoddus", "Oddworld: Abe's Exoddus", 1998, "USA", ["Platformer", "Puzzle"], "Rescue hundreds of workers through an expanded cinematic puzzle-platformer.", "Oddworld - Abe's Exoddus (USA) (Disc 1)"],
  ["crash-bandicoot", "Crash Bandicoot", 1996, "USA", ["Platformer"], "Run toward and away from the camera through dense cartoon obstacle courses.", "Crash Bandicoot (USA)"],
  ["crash-2", "Crash Bandicoot 2: Cortex Strikes Back", 1997, "USA", ["Platformer"], "A polished sequel adds broader movement and hub-driven levels.", "Crash Bandicoot 2 - Cortex Strikes Back (USA)"],
  ["crash-3", "Crash Bandicoot: Warped", 1998, "USA", ["Platformer"], "Time-traveling stages fold vehicles and new abilities into the series formula.", "Crash Bandicoot - Warped (USA)"],
  ["spyro", "Spyro the Dragon", 1998, "USA", ["Platformer"], "Glide across colorful open levels while freeing crystalized dragons.", "Spyro the Dragon (USA)"],
  ["spyro-2", "Spyro 2: Ripto's Rage!", 1999, "USA", ["Platformer"], "New abilities and compact challenges deepen the dragon's bright collectathon.", "Spyro 2 - Ripto's Rage! (USA)"],
  ["rayman", "Rayman", 1995, "USA", ["Platformer"], "Gorgeous hand-drawn worlds conceal a famously demanding platformer.", "Rayman (USA)"],
  ["heart-of-darkness", "Heart of Darkness", 1998, "USA", ["Platformer", "Adventure"], "A boy crosses a beautifully animated nightmare world to rescue his dog.", "Heart of Darkness (USA) (Disc 1)"],
  ["einhander", "Einhänder", 1998, "USA", ["Shooter"], "Square's cinematic side-scroller lets you steal and juggle enemy weapons.", "Einhänder (USA)"],
  ["r-type-delta", "R-Type Delta", 1999, "USA", ["Shooter"], "A moody 3D evolution of the methodical side-scrolling shooter.", "R-Type Delta (USA)"],
  ["g-darius", "G-Darius", 1998, "USA", ["Shooter"], "Capture enemies and fire spectacular beam duels through branching stages.", "G-Darius (USA)"],
  ["raiden-project", "The Raiden Project", 1995, "USA", ["Shooter"], "Two precise arcade vertical shooters arrive in a clean console package.", "Raiden Project, The (USA)"],
  ["strider-2", "Strider 2", 2000, "USA", ["Action", "Platformer"], "A razor-fast arcade action game built around impossible acrobatics.", "Strider 2 (USA)"],
  ["mega-man-x4", "Mega Man X4", 1997, "USA", ["Action", "Platformer"], "Choose X or Zero for two distinct routes through Capcom's polished action game.", "Mega Man X4 (USA)"],
  ["mega-man-legends", "Mega Man Legends", 1998, "USA", ["Action", "Adventure"], "Explore ruins and a cheerful island town in Mega Man's charming 3D reinvention.", "Mega Man Legends (USA)"],
  ["tron-bonne", "The Misadventures of Tron Bonne", 2000, "USA", ["Action", "Adventure"], "Command tiny Servbots through heists, puzzles, and debt repayment.", "Misadventures of Tron Bonne, The (USA)"],
  ["tekken-3", "Tekken 3", 1998, "USA", ["Fighting"], "A fast, generous 3D fighter that became a defining PlayStation showcase.", "Tekken 3 (USA)"],
  ["soul-blade", "Soul Blade", 1997, "USA", ["Fighting"], "Weapon fighting, dramatic ring-outs, and an unforgettable opening cinematic.", "Soul Blade (USA)"],
  ["rival-schools", "Rival Schools", 1998, "USA", ["Fighting"], "School clubs settle an abduction conspiracy through exuberant tag battles.", "Rival Schools - United by Fate (USA) (Disc 1)"],
  ["bushido-blade", "Bushido Blade", 1997, "USA", ["Fighting"], "Weapon duels reject health bars in favor of decisive, often fatal strikes.", "Bushido Blade (USA)"],
  ["bloody-roar-2", "Bloody Roar II", 1999, "USA", ["Fighting"], "Fighters transform into beasts mid-combo in a brisk arcade brawler.", "Bloody Roar II (USA)"],
  ["gran-turismo-2", "Gran Turismo 2", 1999, "USA", ["Racing", "Simulation"], "A vast garage and nuanced handling turn car collecting into an obsession.", "Gran Turismo 2 (USA) (Arcade Mode)"],
  ["ridge-racer-type-4", "R4: Ridge Racer Type 4", 1999, "USA", ["Racing"], "Stylish drift racing, immaculate menus, and a landmark soundtrack.", "R4 - Ridge Racer Type 4 (USA)"],
  ["wipeout-xl", "Wipeout XL", 1996, "USA", ["Racing"], "Anti-gravity racing accelerates through sharp graphic design and club music.", "Wipeout XL (USA)"],
  ["driver", "Driver", 1999, "USA", ["Driving", "Action"], "Go undercover across four open cities in cinematic car chases.", "Driver - You Are the Wheelman (USA)"],
  ["twisted-metal-2", "Twisted Metal 2", 1996, "USA", ["Action", "Driving"], "Weaponized vehicles destroy global arenas in a gleefully grim tournament.", "Twisted Metal 2 (USA)"],
  ["tony-hawk-2", "Tony Hawk's Pro Skater 2", 2000, "USA", ["Sports", "Action"], "Chain tricks through tightly designed stages to a generation-defining soundtrack.", "Tony Hawk's Pro Skater 2 (USA)"],
  ["cool-boarders-2", "Cool Boarders 2", 1997, "USA", ["Sports", "Racing"], "Arcade snowboarding balances speed, tricks, and gloriously severe presentation.", "Cool Boarders 2 (USA)"],
  ["intelligent-qube", "Intelligent Qube", 1997, "USA", ["Puzzle"], "Survive advancing walls of cubes in a stark, orchestral puzzle arena.", "Intelligent Qube (USA)"],
  ["kula-world", "Roll Away", 1998, "USA", ["Puzzle"], "Roll a beach ball across gravity-bending floating mazes.", "Roll Away (USA)"],
  ["kurushi-final", "Kurushi Final: Mental Blocks", 1999, "Europe", ["Puzzle"], "The minimalist cube-crushing puzzle returns with broader modes and pressure.", "Kurushi Final - Mental Blocks (Europe)"],
  ["future-cop-lapd", "Future Cop: L.A.P.D.", 1998, "USA", ["Action", "Strategy"], "Pilot a transforming police mech through missions and a proto-MOBA precinct mode.", "Future Cop - L.A.P.D. (USA)"],
  ["omega-boost", "Omega Boost", 1999, "USA", ["Shooter", "Action"], "Polyphony Digital sends a transforming mech through dazzling rail-shooter battles.", "Omega Boost (USA)"],
  ["colony-wars", "Colony Wars", 1997, "USA", ["Simulation", "Shooter"], "Fight a branching space war whose campaign continues through failure.", "Colony Wars (USA) (Disc 1)"],
  ["fear-effect", "Fear Effect", 2000, "USA", ["Action", "Adventure"], "Mercenaries cross a cel-shaded cyberpunk thriller with supernatural horror.", "Fear Effect (USA) (Disc 1)"],
];

const broaderGames = broaderSeeds.map(([id, title, year, region, genres, description, cover]) =>
  g(id, title, year, region, genres, [], description, "A strong reason to keep exploring the PlayStation library.", "1", "Various", cover),
);

// Japanese records require a separately verified patch/provenance record. The
// core catalog owns those hand-curated translations; this wider pass adds the
// substantial English-language PS1 library without pretending every Japanese
// fan patch has been independently verified here.
const expandedEnglishGames = ps1Expansion
  .filter(([, , , region]) => region !== "Japan")
  .map(([id, title, year, region, genres, description, cover]) =>
    g(id, title, year, region, genres, [], description, "A strong reason to keep exploring the PlayStation library.", "1", "Various", cover),
  );

const legacyGames = [...coreGames, ...broaderGames, ...expandedEnglishGames];
const titleKey = (title: string) =>
  title.toLowerCase().replace(/\s*\(disc\s*\d+\)\s*$/i, "").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");
const legacyUsByTitle = new Map(
  legacyGames.filter((game) => game.region === "USA").map((game) => [titleKey(game.title), game]),
);

/**
 * Card subtitle. This used to be `{year} · {genres}` unconditionally, so a
 * record the provider had no data for rendered the literal string "0 · " —
 * a missing field presented as a year of zero. Only the parts that exist are
 * joined, so a gap now reads as absent instead of as data.
 */
export const metaLine = (game: Game) =>
  [game.year ? String(game.year) : null, game.genres.join(" / ") || null]
    .filter(Boolean)
    .join(" · ");

/**
 * LaunchBox publishes a maximum player count, not the range the detail view
 * shows. One player is stated exactly; anything higher is the top of a range
 * that necessarily starts at one.
 */
const playerRange = (maxPlayers: string | null) =>
  !maxPlayers || maxPlayers === "0" ? undefined : maxPlayers === "1" ? "1" : `1-${maxPlayers}`;

const sourcedUsGames = usCatalog.map((seed) => {
  const existing = legacyUsByTitle.get(titleKey(seed.title));
  const game = g(
    existing?.id ?? seed.id,
    existing?.title ?? seed.title,
    seed.year || existing?.year || 0,
    "USA",
    seed.genres.length ? seed.genres : existing?.genres ?? [],
    existing?.facets ?? [],
    // A curated description used to be discarded whenever the imported record
    // had none, so hand-written copy lost to an empty provider field.
    seed.description ?? existing?.description ?? "",
    "",
    playerRange(seed.players) ?? existing?.players ?? "Unknown",
    seed.developer ?? existing?.developer ?? "Unknown",
    seed.coverName,
  );
  game.curatorNote = undefined;
  game.publisher = seed.publisher ?? undefined;
  game.esrb = seed.esrb ?? undefined;
  game.rating = seed.rating
    ? { source: "LaunchBox community", score: seed.rating.score, count: seed.rating.count }
    : undefined;
  if (seed.descriptionSource) {
    game.descriptionSource = { label: "Catalog description source", url: seed.descriptionSource };
    game.links.unshift({ label: "Description source", url: seed.descriptionSource, state: "verified" });
  }
  return game;
});
const sourcedUsTitles = new Set(sourcedUsGames.map((game) => titleKey(game.title)));

// OpenVGDB supplies the complete English-language USA retail base. The prior
// hand-verified Europe-only and translated Japan records remain eligible under
// the project's existing regional rules. Missing source copy stays empty.
export const games: Game[] = [
  ...sourcedUsGames,
  ...legacyGames
    .filter((game) => game.region !== "USA" && !sourcedUsTitles.has(titleKey(game.title)))
    .map((game) => ({ ...game, curatorNote: undefined })),
];

type ShelfRecipe = { title: string; subtitle: string; matches: (game: Game) => boolean };
const shelfRecipes: ShelfRecipe[] = [
  { title: "Beautifully Weird", subtitle: "Surreal worlds, odd controls, and singular ideas.", matches: (game) => game.facets.some((facet) => ["Surreal", "Bizarre premise", "Experimental controls", "Outsider art"].includes(facet)) },
  { title: "Midnight Dread", subtitle: "Horror for after everyone else goes to sleep.", matches: (game) => game.genres.includes("Horror") || game.facets.includes("Body horror") },
  { title: "Arcade Reflexes", subtitle: "Immediate starts, quick decisions, and score chasing.", matches: (game) => game.genres.some((genre) => ["Arcade", "Shooter", "Light gun"].includes(genre)) },
  { title: "Lose a Weekend", subtitle: "Big journeys, deep systems, and dangerous save files.", matches: (game) => game.genres.includes("RPG") || game.genres.includes("Strategy") },
  { title: "Puzzle Cabinet", subtitle: "Mechanical ideas worth turning over in your head.", matches: (game) => game.genres.includes("Puzzle") },
  { title: "Head to Head", subtitle: "Fighters, grapplers, and competitive grudges.", matches: (game) => game.genres.includes("Fighting") || game.genres.includes("Wrestling") },
  { title: "Road Fever", subtitle: "Racing, wrecking, and going much too fast.", matches: (game) => game.genres.includes("Racing") || game.genres.includes("Driving") },
  { title: "Adventure Calls", subtitle: "Places to explore and stories to get lost inside.", matches: (game) => game.genres.includes("Adventure") || game.genres.includes("Platformer") },
  { title: "Sports Night", subtitle: "Arcade spectacle and full-season obsession.", matches: (game) => game.genres.includes("Sports") },
];

const shuffled = <T,>(values: T[], random: () => number) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
};

export const createCuratedShelves = (random: () => number = Math.random) =>
  shuffled(shelfRecipes, random).slice(0, 4).map((recipe) => ({
    title: recipe.title,
    subtitle: recipe.subtitle,
    ids: shuffled(games.filter(recipe.matches), random).slice(0, 6).map((game) => game.id),
  })).filter((shelf) => shelf.ids.length > 0);

export const facetOrder = [
  "Surreal",
  "Bizarre premise",
  "Genre collision",
  "Experimental controls",
  "Camp",
  "Uncanny",
  "Frantic comedy",
  "Mascot nightmare",
  "Outsider art",
  "Body horror",
  "Minimalist",
];
import { ps1Expansion } from "./ps1Expansion";
import { usCatalog } from "./ps1UsCatalog";
import { translationManifest } from "./translationManifest";
