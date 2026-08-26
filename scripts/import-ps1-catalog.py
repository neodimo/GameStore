#!/usr/bin/env python3
"""Build the compact USA PlayStation catalog from two pinned metadata sources.

OpenVGDB decides *which* releases exist and what No-Intro/Redump filename each
one is published under, because it is keyed on actual ROM dumps. It is a poor
source for the human-facing fields: of its 1,695 USA English PlayStation
release rows only 244 carry a release date or developer and only 658 carry a
genre or description, and merging the Japan/Europe/regional rows for the same
title recovers essentially none of the gap.

The LaunchBox Games Database covers the same library at 93-95% on exactly those
fields, and adds max players, publisher, ESRB and a community rating. It is
therefore layered on top: OpenVGDB stays authoritative for identity and dump
naming, LaunchBox supplies the copy the catalog UI actually renders.

Neither dump is committed. Both are fetched into a temporary directory and only
the compact generated TypeScript seed lands in the repository.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import tempfile
import unicodedata
import urllib.request
import xml.etree.ElementTree as ElementTree
import zipfile
from pathlib import Path

OPENVGDB_VERSION = "v29.0"
OPENVGDB_URL = f"https://github.com/OpenVGDB/OpenVGDB/releases/download/{OPENVGDB_VERSION}/openvgdb.zip"
LAUNCHBOX_URL = "https://gamesdb.launchbox-app.com/Metadata.zip"
LAUNCHBOX_PLATFORM = "Sony Playstation"
LAUNCHBOX_GAME_URL = "https://gamesdb.launchbox-app.com/games/details/{}"

NON_RETAIL = re.compile(
    r"\((?:demo|beta|proto|sample|review code|trade demo|press kit)(?:\)|,)", re.I
)
DISC_AFTER_FIRST = re.compile(r"\(Disc [2-9](?:\)|,)", re.I)

# OpenVGDB publishes the dump filename with its extension; Libretro names each
# thumbnail after the release itself, without one. Stripping only `.cue`
# happened to work for PlayStation, because every Redump disc name ends that
# way, and silently produced `... (USA).n64.png` for every cartridge system —
# a URL that 404s for the whole catalog rather than for a few odd titles.
#
# The set is explicit and `cover_name` reports anything it does not recognise,
# because guessing at "strip whatever follows the last dot" would eat a title
# that legitimately ends in one.
ROM_EXTENSIONS = {
    # Optical
    "cue", "chd", "iso", "bin", "gdi", "ccd", "img",
    # Nintendo
    "n64", "z64", "v64", "nes", "fds", "sfc", "smc", "gb", "gbc", "gba", "nds",
    # Sega
    "md", "gen", "smd", "sms", "gg", "32x",
    # Other cartridge families the catalog could plausibly grow into
    "pce", "sgx", "a26", "a78", "lnx", "ngp", "ngc", "ws", "wsc", "col", "int",
}
SUFFIX = re.compile(r"\.([A-Za-z0-9]{1,4})$")

# Discs that are not a game to play. Redump lists them because they are real
# PlayStation discs; a catalog for finding something to play should not.
#
# Every pattern here is anchored or requires an adjacent word, because the
# obvious keyword versions delete real games: `underground` takes out Medal of
# Honor: Underground and Professional Underground League of Pain, `trial`
# matches inside "Extra-Terrestrial", and `xplorer` matches Barbie: Explorer and
# Dora the Explorer. A filter that removes 79 discs is worth nothing if it also
# removes one game somebody wanted.
NON_GAME = [
    # Cheat cartridges and boot discs, anchored so only a title that starts
    # with the device name qualifies.
    ("cheat device", re.compile(
        r"^(?:GameShark|Game Shark|Code ?Breaker|PS-X-Change|Action Replay|Xplorer|Game Genie|Caetla)\b", re.I,
    )),
    # Demo, sampler and magazine cover discs. "Demo" alone is far too broad, so
    # both words are required.
    # `Playable Demo` and `Playable Game Preview` are how Sega labelled the
    # Saturn ones, and `Demo Vol.`/`Preview Vol.` are the numbered series. Each
    # still requires an adjacent word: bare `demo` deletes Pandemonium! and
    # bare `preview` is a normal English word a real title can contain.
    ("demo disc", re.compile(
        r"\bDemo (?:CD|Disc)\b|\bInteractive (?:CD )?Sampler\b|\bCollector'?s CD\b"
        r"|\bJampack\b|PlayStation Underground"
        r"|\bPlayable (?:Demo|Game Preview)\b|\b(?:Demo|Preview) Vol\.", re.I,
    )),
    # Redump's `(Bonus Disc)` tag means exactly "this is the extra disc, not the
    # game" — the Gran Turismo 2 album and the Persona 2 bonus disc, whose own
    # games are separate catalog entries and stay.
    ("bonus disc", re.compile(r"\((?:Bonus(?: PlayStation)? Disc)\)", re.I)),
]

# Promotional and bundled sampler discs whose names share no pattern with each
# other or with anything above. Their own provider descriptions identify them
# ("a special Demo / Promotion Give-away", "a sampler disc full of game demos
# and trailers that was shipped with every PlayStation at launch"). Widening a
# regex until it caught these would start eating real games, so they are named.
#
# Deliberately kept: `Ridge Racer Bonus Turbo Mode Disc`. It is a bonus disc,
# but it is a playable game rather than a demo reel or an album, which is the
# line drawn here.
NON_GAME_TITLES = {
    "Pizza Hut Disc 1",
    "Pizza Hut Disc 2",
    "PlayStation Picks",
    "Toys 'R' Us: Attack of the Killer Demos!",
    # Sega's US Saturn demo disc. Its own provider copy calls it a
    # "Miscellaneous game", and `Sampler` on its own is too broad to match on.
    "Bootleg Sampler",
}


def non_game(title: str, filename: str) -> str | None:
    if title in NON_GAME_TITLES:
        return "promo disc"
    for label, pattern in NON_GAME:
        if pattern.search(title) or pattern.search(filename):
            return label
    return None

# Both providers are folded into one vocabulary. The catalog's genre filter and
# its shelf recipes match on these exact strings, so an unmapped provider term
# would quietly create a second, near-duplicate entry in the dropdown.
GENRE_ALIASES = {
    "Role-Playing": "RPG",
    "Action Adventure": "Adventure",
    "Platform": "Platformer",
    "Beat 'em Up": "Beat 'em up",
    "Flight Simulator": "Flight",
    "Life Simulation": "Simulation",
    "Vehicle Simulation": "Simulation",
    "Construction and Management Simulation": "Simulation",
    "Music": "Rhythm",
    "Dancing": "Rhythm",
}
GENRE_NOISE = {"General", "Other", "Miscellaneous"}

# 173 of OpenVGDB's 658 PlayStation descriptions are a generated sentence rather
# than written copy ("2 Xtreme is a Driving game, developed by ... and published
# by ..., which was released in 1996."). They restate fields the catalog already
# shows, so they lose to a real LaunchBox overview instead of blocking it.
STUB_DESCRIPTION = re.compile(
    r"^.{1,80}? is an? .{1,40}? game,\s*developed by .+? and published by ", re.I | re.S
)

# A community score standing on one or two votes is noise dressed as data.
MINIMUM_RATING_VOTES = 5


def slug(value: str) -> str:
    value = value.lower().replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "untitled"


def match_key(title: str) -> str:
    """Normalized join key shared by both providers.

    Parentheticals, leading articles and trailing ", The" are all release-naming
    decoration rather than identity, and the two databases disagree about them
    constantly. Stripping them resolves 1,441 of 1,462 catalog titles by exact
    lookup, which is why this importer needs no fuzzy scoring at all.
    """
    value = unicodedata.normalize("NFKD", title).lower().replace("&", " and ")
    value = re.sub(r"\s*\([^)]*\)", "", value)
    value = re.sub(r"^(the|a)\s+", "", value)
    value = re.sub(r",\s*(the|a)$", "", value)
    return re.sub(r"[^a-z0-9]+", "", value)


def year(value: str | None) -> int:
    if not value:
        return 0
    match = re.search(r"(?:19|20)\d{2}", value)
    return int(match.group()) if match else 0


unrecognized_suffixes: dict[str, int] = {}


def cover_name(filename: str) -> str:
    """The release name a Libretro thumbnail is published under.

    That is the dump filename with its ROM/disc extension removed. An
    unrecognised suffix is counted and left in place rather than guessed at, so
    a new system announces itself in the import summary instead of quietly
    emitting cover URLs that all 404.
    """
    match = SUFFIX.search(filename)
    if not match:
        return filename
    if match.group(1).lower() not in ROM_EXTENSIONS:
        suffix = match.group(1).lower()
        unrecognized_suffixes[suffix] = unrecognized_suffixes.get(suffix, 0) + 1
        return filename
    return filename[: match.start()]


def genres(value: str | None, separator: str) -> list[str]:
    if not value:
        return []
    useful: list[str] = []
    for item in value.split(separator):
        item = GENRE_ALIASES.get(item.strip(), item.strip())
        if item and item not in useful and item not in GENRE_NOISE:
            useful.append(item)
    return useful[:4]


def fetch(url: str, destination: Path, member: str, cache: Path | None) -> Path:
    """Download a provider archive and extract one member.

    `cache` keeps the two large dumps (roughly 150 MB combined) out of repeated
    downloads while iterating on the mapping rules. Neither the archives nor the
    extracted members are ever written inside the repository.
    """
    if cache is not None and (cache / member).exists():
        return cache / member
    archive = destination / "download.zip"
    # LaunchBox rejects the default urllib user agent with a 403.
    request = urllib.request.Request(url, headers={"User-Agent": "GameStore-catalog-import/1"})
    with urllib.request.urlopen(request) as response, archive.open("wb") as handle:
        while chunk := response.read(1 << 20):
            handle.write(chunk)
    with zipfile.ZipFile(archive) as zipped:
        zipped.extract(member, cache or destination)
    archive.unlink()
    return (cache or destination) / member


def load_openvgdb(
    database: Path, system_id: int, include_europe_fallback: bool = False,
) -> tuple[list[dict[str, object]], dict[str, int]]:
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        """
        SELECT rel.releaseTitleName, rel.releaseDescription,
               rel.releaseDeveloper, rel.releaseGenre, rel.releaseDate,
               rel.releaseReferenceURL, rel.TEMPregionLocalizedName,
               rom.romFileName, rom.romLanguage
        FROM RELEASES rel
        JOIN ROMs rom ON rom.romID = rel.romID
        WHERE rom.systemID = ?
          AND rel.TEMPregionLocalizedName IN ('USA', 'Europe')
          AND (rom.romLanguage LIKE '%English%' OR rom.romLanguage IS NULL)
        """,
        (system_id,),
    ).fetchall()

    candidates: dict[str, sqlite3.Row] = {}
    excluded: dict[str, int] = {}
    for row in rows:
        filename = row["romFileName"] or ""
        title = row["releaseTitleName"] or ""
        region = row["TEMPregionLocalizedName"]
        if region == "Europe" and not include_europe_fallback:
            continue
        if NON_RETAIL.search(filename) or DISC_AFTER_FIRST.search(filename):
            continue
        # The release title is checked too, not only the dump name. Saturn's
        # `Deep Fear (Disc 2)` is titled as the second disc while pointing at
        # the `(Disc 1)` dump, so a filename-only test kept a record whose two
        # halves disagree about which disc it even is.
        if DISC_AFTER_FIRST.search(title) or re.search(r"\(Disc [2-9]\)", title):
            continue
        label = non_game(title, filename)
        if label:
            excluded[label] = excluded.get(label, 0) + 1
            continue
        identity = match_key(title)
        previous = candidates.get(identity)
        # Prefer a source-backed description, then the least decorated retail dump.
        # USA is the default library. European English releases only survive
        # when the title has no USA release, which preserves PAL-only games
        # without duplicating regional editions.
        score = (region == "USA", bool(row["releaseDescription"]), -filename.count("("), filename)
        old_score = (
            previous["TEMPregionLocalizedName"] == "USA",
            bool(previous["releaseDescription"]),
            -(previous["romFileName"] or "").count("("),
            previous["romFileName"] or "",
        ) if previous else None
        if previous is None or score > old_score:
            candidates[identity] = row

    used_ids: dict[str, int] = {}
    output = []
    for _, row in sorted(candidates.items(), key=lambda item: (item[1]["releaseTitleName"] or "").casefold()):
        title = row["releaseTitleName"] or ""
        base_id = slug(title)
        used_ids[base_id] = used_ids.get(base_id, 0) + 1
        record_id = base_id if used_ids[base_id] == 1 else f"{base_id}-{used_ids[base_id]}"
        description = (row["releaseDescription"] or "").strip() or None
        output.append({
            "id": record_id,
            "title": title,
            "year": year(row["releaseDate"]),
            "genres": genres(row["releaseGenre"], ","),
            "description": description,
            "descriptionSource": row["releaseReferenceURL"] if description else None,
            "developer": (row["releaseDeveloper"] or "").strip() or None,
            "coverName": cover_name(row["romFileName"] or ""),
        })
    return output, excluded


def load_launchbox(metadata: Path) -> dict[str, dict[str, str]]:
    """Index every PlayStation entry by its own name and each alternate name.

    Alternate names are what make regional retitles (`Roll Away` / `Kula
    World`) resolve without fuzzy matching. `setdefault` keeps the primary
    name authoritative whenever an alternate collides with it.
    """
    by_key: dict[str, dict[str, str]] = {}
    by_id: dict[str, dict[str, str]] = {}
    for _, element in ElementTree.iterparse(metadata, events=("end",)):
        if element.tag == "Game":
            if (element.findtext("Platform") or "") == LAUNCHBOX_PLATFORM:
                game = {child.tag: (child.text or "").strip() for child in element}
                by_id[game["DatabaseID"]] = game
                by_key.setdefault(match_key(game["Name"]), game)
            element.clear()
        elif element.tag == "GameAlternateName":
            database_id = element.findtext("DatabaseID")
            name = element.findtext("AlternateName")
            if database_id in by_id and name:
                by_key.setdefault(match_key(name), by_id[database_id])
            element.clear()
    return by_key


def rating(game: dict[str, str]) -> dict[str, object] | None:
    score = game.get("CommunityRating") or ""
    count = int(game.get("CommunityRatingCount") or 0)
    if not score or count < MINIMUM_RATING_VOTES:
        return None
    return {"score": round(float(score), 2), "count": count}


def enrich(records: list[dict[str, object]], launchbox: dict[str, dict[str, str]]) -> int:
    matched = 0
    for record in records:
        game = launchbox.get(match_key(str(record["title"])))
        if game is None:
            # The dump name is the second identity a release is published
            # under, so try it before giving up on the title alone.
            stripped = re.sub(r"\s*\(.*$", "", str(record["coverName"]))
            game = launchbox.get(match_key(stripped))
        if game is None:
            record["players"] = None
            record["publisher"] = None
            record["esrb"] = None
            record["rating"] = None
            continue
        matched += 1

        # LaunchBox leads on genre because its 27-term controlled vocabulary
        # keeps the filter dropdown coherent; OpenVGDB emits free text such as
        # "Driving, Racing, Snow / Water" that fragments it.
        provider_genres = genres(game.get("Genres"), ";")
        if provider_genres:
            record["genres"] = provider_genres

        if not record["year"]:
            record["year"] = year(game.get("ReleaseDate") or game.get("ReleaseYear"))
        if not record["developer"]:
            record["developer"] = game.get("Developer") or None
        # An OpenVGDB description already carries a verifiable reference URL, so
        # written copy is kept; LaunchBox fills the records that had none and
        # replaces the generated one-line stubs.
        existing = str(record["description"] or "")
        if existing and STUB_DESCRIPTION.match(existing):
            record["description"] = None
            record["descriptionSource"] = None
        if not record["description"] and game.get("Overview"):
            record["description"] = game["Overview"]
            record["descriptionSource"] = LAUNCHBOX_GAME_URL.format(game["DatabaseID"])

        record["players"] = game.get("MaxPlayers") or None
        record["publisher"] = game.get("Publisher") or None
        record["esrb"] = game.get("ESRB") or None
        record["rating"] = rating(game)
    return matched


def main() -> None:
    global LAUNCHBOX_PLATFORM
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--system-id", type=int, default=38)
    parser.add_argument("--launchbox-platform", default=LAUNCHBOX_PLATFORM)
    parser.add_argument("--europe-fallback", action="store_true")
    parser.add_argument(
        "--cache",
        type=Path,
        help="Reuse provider dumps already extracted here instead of downloading them.",
    )
    arguments = parser.parse_args()
    cache = arguments.cache
    if cache is not None:
        cache.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        LAUNCHBOX_PLATFORM = arguments.launchbox_platform
        records, excluded = load_openvgdb(
            fetch(OPENVGDB_URL, root, "openvgdb.sqlite", cache),
            arguments.system_id,
            arguments.europe_fallback,
        )
        matched = enrich(records, load_launchbox(fetch(LAUNCHBOX_URL, root, "Metadata.xml", cache)))

    payload = json.dumps(records, ensure_ascii=False, separators=(",", ":"))
    content = (
        f"// Generated by scripts/import-ps1-catalog.py from OpenVGDB {OPENVGDB_VERSION}\n"
        "// (release identity and No-Intro dump names) enriched with the LaunchBox\n"
        "// Games Database (year, genre, developer, copy, players, ESRB, rating).\n"
        "// Do not hand-edit. Descriptions keep a per-game reference URL; missing\n"
        "// copy stays missing rather than being invented.\n"
        "export type UsCatalogSeed = {\n"
        "  id: string;\n"
        "  title: string;\n"
        "  year: number;\n"
        "  genres: string[];\n"
        "  description: string | null;\n"
        "  descriptionSource: string | null;\n"
        "  developer: string | null;\n"
        "  coverName: string;\n"
        "  players: string | null;\n"
        "  publisher: string | null;\n"
        "  esrb: string | null;\n"
        "  rating: { score: number; count: number } | null;\n"
        "};\n"
        f"export const usCatalog: UsCatalogSeed[] = {payload};\n"
    )
    arguments.output.write_text(content, encoding="utf-8")

    total = len(records)
    def filled(field: str) -> str:
        count = sum(1 for record in records if record[field])
        return f"{field} {count}/{total}"

    print(f"Wrote {total} USA retail games to {arguments.output}")
    print("  Excluded as not a game: " + " · ".join(
        f"{label} {count}" for label, count in sorted(excluded.items())) )
    print(f"  LaunchBox matched {matched}/{total}")
    if unrecognized_suffixes:
        print("  Unrecognized dump suffixes left on coverName: " + " · ".join(
            f".{suffix} {count}" for suffix, count in sorted(unrecognized_suffixes.items())))
        print("  Add them to ROM_EXTENSIONS; their artwork URLs will not resolve.")
    print("  " + " · ".join(
        filled(field)
        for field in ("year", "genres", "description", "developer", "players", "esrb", "rating")
    ))


if __name__ == "__main__":
    main()
