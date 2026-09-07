"""Import a console catalog for platforms OpenVGDB does not cover.

`import-ps1-catalog.py` sources release identity from OpenVGDB and enriches it
with LaunchBox. That pipeline cannot be pointed at PlayStation 2 or Xbox 360:
OpenVGDB v29.0's SYSTEMS table ends at Sony PlayStation Portable and contains
neither console, so there is no release table to join against. This importer
inverts the two roles instead of inventing data — LaunchBox supplies release
identity and metadata, and the Libretro thumbnail index supplies the published
artwork name where one exists.

The artwork situation differs sharply between the two consoles and was read from
the live index rather than assumed:

  Sony - PlayStation 2   8501 box arts   most releases resolve by name
  Microsoft - Xbox 360     12 box arts   effectively unpopulated

So PS2 records carry a `coverName` whenever the index publishes one, and Xbox
360 records almost never do. A record without one is not broken: the renderer
falls back to its runtime resolver (fuzzy index match, then TheGamesDB), which
is the same path any unmatched title already takes.

Selection is by community rating count, descending. The full LaunchBox sets are
4763 (PS2) and 5660 (Xbox 360) released games; both consoles at full size push
the web bundle past the 3.00 MiB budget in config/media-light.json, so `--limit`
takes the most widely rated releases rather than an arbitrary alphabetical
prefix. 220 per console measured at 2.90 MiB; 250 measured at 2.97 MiB. Raise it
only alongside a measured `npm run check:bundle-size`.

Usage:
  python3 scripts/import-launchbox-catalog.py src/ps2UsCatalog.ts \
      --launchbox-platform "Sony Playstation 2" \
      --thumbnail-system "Sony - PlayStation 2" --limit 220
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import shutil
import tempfile
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

LAUNCHBOX_URL = "https://gamesdb.launchbox-app.com/Metadata.zip"
THUMBNAIL_ROOT = "https://thumbnails.libretro.com"

# Compilations, demos and other non-retail entries LaunchBox files alongside
# releases. Matched against the game name, which is the only signal available
# here — there is no dump filename to test the way the OpenVGDB importer does.
NON_RETAIL = re.compile(
    r"\b(demo|beta|prototype|sampler|kiosk|trade demo|not for resale|bonus disc)\b",
    re.IGNORECASE,
)


def _ps1_importer():
    """The OpenVGDB importer, loaded for its genre vocabulary.

    Both importers feed one genre filter and one set of shelf recipes, which
    match on exact strings. Copying the alias table here would let the two
    consoles drift into near-duplicate dropdown entries — "Role-Playing" beside
    "RPG" — so the table is read from the module that already owns it. The
    filename has a hyphen, so it cannot be imported by name.
    """
    path = Path(__file__).with_name("import-ps1-catalog.py")
    spec = importlib.util.spec_from_file_location("import_ps1_catalog", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


_PS1 = _ps1_importer()
GENRE_ALIASES = _PS1.GENRE_ALIASES
GENRE_NOISE = _PS1.GENRE_NOISE


def genres(value: str | None) -> list[str]:
    """LaunchBox genres folded into the shared vocabulary, capped like the
    OpenVGDB importer caps them so one console cannot render a longer meta
    line than another."""
    useful: list[str] = []
    for item in (value or "").split(";"):
        item = GENRE_ALIASES.get(item.strip(), item.strip())
        if item and item not in useful and item not in GENRE_NOISE:
            useful.append(item)
    return useful[:4]


def match_key(title: str) -> str:
    """Loose comparison key. Matches the OpenVGDB importer's normalization so a
    title lines up with its thumbnail whether or not the two agree on
    punctuation, articles, or regional suffixes."""
    text = unicodedata.normalize("NFKD", title)
    text = "".join(character for character in text if not unicodedata.combining(character))
    text = re.sub(r"\s*\([^)]*\)", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text.lower())
    text = re.sub(r"\b(the|a|an)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def slug(title: str) -> str:
    text = unicodedata.normalize("NFKD", title)
    text = "".join(character for character in text if not unicodedata.combining(character))
    text = re.sub(r"[^a-z0-9]+", "-", text.lower())
    return text.strip("-")


def fetch(url: str, root: Path, member: str, cache: Path | None) -> Path:
    if cache is not None and (cache / member).exists():
        return cache / member
    archive = root / "download.zip"
    with urllib.request.urlopen(url) as response, archive.open("wb") as handle:
        shutil.copyfileobj(response, handle)
    with zipfile.ZipFile(archive) as bundle:
        bundle.extract(member, root)
    if cache is not None:
        shutil.copy(root / member, cache / member)
    return root / member


def thumbnail_names(system: str, cache: Path | None) -> dict[str, str]:
    """Published box-art names keyed for loose matching.

    USA wins over Europe wins over Japan when a title is published more than
    once, because the catalog prefers the English release it already prefers
    everywhere else.
    """
    member = f"boxarts-{slug(system)}.html"
    if cache is not None and (cache / member).exists():
        page = (cache / member).read_text(encoding="utf-8", errors="replace")
    else:
        url = f"{THUMBNAIL_ROOT}/{urllib.parse.quote(system)}/Named_Boxarts/"
        with urllib.request.urlopen(url) as response:
            page = response.read().decode("utf-8", errors="replace")
        if cache is not None:
            (cache / member).write_text(page, encoding="utf-8")

    rank = {"(USA": 0, "(Europe": 1, "(World": 2}
    best: dict[str, tuple[int, str]] = {}
    for href in re.findall(r'href="([^"]+\.png)"', page):
        name = urllib.parse.unquote(href)[: -len(".png")]
        score = next((value for prefix, value in rank.items() if prefix in name), 3)
        key = match_key(name)
        if key and (key not in best or score < best[key][0]):
            best[key] = (score, name)
    return {key: name for key, (_, name) in best.items()}


def load_launchbox(metadata: Path, platform: str) -> list[dict[str, object]]:
    games: list[dict[str, object]] = []
    # Only `Game` elements are cleared. Clearing every element on its own end
    # event drops each child as it closes, so the parent's `findtext` calls all
    # return nothing and the import silently writes zero records.
    for _event, element in ET.iterparse(metadata, events=("end",)):
        if element.tag != "Game":
            continue
        if (element.findtext("Platform") or "") != platform:
            element.clear()
            continue
        name = (element.findtext("Name") or "").strip()
        released = (element.findtext("ReleaseType") or "Released").strip()
        if not name or released != "Released" or NON_RETAIL.search(name):
            element.clear()
            continue
        year = element.findtext("ReleaseYear") or ""
        if not year:
            date = element.findtext("ReleaseDate") or ""
            year = date[:4]
        rating = element.findtext("CommunityRating")
        count = element.findtext("CommunityRatingCount")
        overview = (element.findtext("Overview") or "").strip()
        database_id = element.findtext("DatabaseID")
        games.append(
            {
                "id": slug(name),
                "title": name,
                "year": int(year) if year.isdigit() else 0,
                "genres": genres(element.findtext("Genres")),
                "description": overview or None,
                "descriptionSource": (
                    f"https://gamesdb.launchbox-app.com/games/details/{database_id}"
                    if database_id and overview
                    else None
                ),
                "developer": (element.findtext("Developer") or "").strip() or None,
                "coverName": "",
                "players": (element.findtext("MaxPlayers") or "").strip() or None,
                "publisher": (element.findtext("Publisher") or "").strip() or None,
                "esrb": (element.findtext("ESRB") or "").strip() or None,
                "rating": (
                    {"score": round(float(rating), 2), "count": int(count)}
                    if rating and count and count.isdigit() and int(count) > 0
                    else None
                ),
            }
        )
        element.clear()
    return games


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--launchbox-platform", required=True)
    parser.add_argument("--thumbnail-system", required=True)
    parser.add_argument("--limit", type=int, default=220)
    parser.add_argument("--cache", type=Path)
    arguments = parser.parse_args()
    cache = arguments.cache
    if cache is not None:
        cache.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        games = load_launchbox(
            fetch(LAUNCHBOX_URL, root, "Metadata.xml", cache), arguments.launchbox_platform
        )
        covers = thumbnail_names(arguments.thumbnail_system, cache)

    seen: set[str] = set()
    unique: list[dict[str, object]] = []
    for game in games:
        if game["id"] in seen:
            continue
        seen.add(str(game["id"]))
        unique.append(game)

    # Ranked before truncation so the cut keeps the releases people actually
    # rated, and a game with no rating at all still sorts by year rather than
    # by whatever order the XML happened to be in.
    unique.sort(
        key=lambda game: (
            -(game["rating"]["count"] if game["rating"] else 0),
            -(game["year"] or 0),
            str(game["title"]),
        )
    )
    records = unique[: arguments.limit]

    matched = 0
    for record in records:
        name = covers.get(match_key(str(record["title"])))
        if name:
            record["coverName"] = name
            matched += 1

    payload = json.dumps(records, ensure_ascii=False, separators=(",", ":"))
    content = (
        "// Generated by scripts/import-launchbox-catalog.py from the LaunchBox\n"
        "// Games Database (release identity and metadata) with box-art names read\n"
        f"// from {THUMBNAIL_ROOT}/{arguments.thumbnail_system}/Named_Boxarts/.\n"
        "// OpenVGDB v29.0 has no table for this console, so LaunchBox is the\n"
        "// identity source here rather than the enrichment source.\n"
        "// Do not hand-edit. Missing copy stays missing rather than being invented.\n"
        'import type { UsCatalogSeed } from "./n64UsCatalog";\n'
        f"export const usCatalog: UsCatalogSeed[] = {payload};\n"
    )
    arguments.output.write_text(content, encoding="utf-8")

    total = len(records)
    print(f"Wrote {total} games to {arguments.output} (of {len(unique)} released)")
    print(f"  Box art names matched {matched}/{total}")
    for field in ("year", "genres", "description", "developer", "players", "esrb", "rating"):
        filled = sum(1 for record in records if record[field])
        print(f"  {field} {filled}/{total}")


if __name__ == "__main__":
    main()
