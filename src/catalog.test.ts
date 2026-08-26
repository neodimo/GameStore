import { describe, expect, it } from 'vitest';
import { createCuratedShelves, games, metaLine, translationSearchTerm, translationSearchUrl } from './catalog';
import { ps1Expansion } from './ps1Expansion';
describe('catalog invariants',()=>{
 it('contains the full USA retail base plus the eligible regional catalog',()=>{expect(games.filter(g=>g.region==='USA').length).toBeGreaterThanOrEqual(1350);expect(new Set(games.map(g=>g.id)).size).toBe(games.length)});
 it('adds a sourced N64 catalog without admitting unreviewed Japanese imports',()=>{
  const n64=games.filter(g=>g.platform==='N64');
  expect(n64.length).toBeGreaterThanOrEqual(300);
  expect(n64.every(g=>g.region==='USA'||g.region==='Europe')).toBe(true);
  expect(n64.every(g=>Boolean(g.cover)&&g.cover!.includes('Nintendo%20-%20Nintendo%2064'))).toBe(true);
 });
 it('adds a Sega Saturn catalog from the same pinned import pipeline',()=>{
  const saturn=games.filter(g=>g.platform==='SAT');
  expect(saturn.length).toBeGreaterThanOrEqual(200);
  expect(saturn.every(g=>g.region==='USA'||g.region==='Europe')).toBe(true);
  expect(saturn.every(g=>g.id.startsWith('sat-'))).toBe(true);
  // Saturn discs are Redump `.cue` names; the extension must already be gone.
  expect(saturn.every(g=>!/\.(cue|chd|bin|iso)$/i.test(g.coverName??''))).toBe(true);
 });
 /**
  * Demo and preview discs the PlayStation patterns did not describe, because
  * Sega labelled its Saturn ones differently. `Pandemonium!` is pinned beside
  * them for the same reason the PS1 near-misses are: the obvious keyword
  * version of this filter matches `demo` inside `Pandemonium` and deletes a
  * real game.
  */
 it('excludes Saturn demo discs without eating a title that merely contains one',()=>{
  const titles=new Set(games.map(g=>g.title));
  for(const gone of ['Bootleg Sampler','Core Demo Vol. 2','Panzer Dragoon: Playable Demo','Rayman: Playable Game Preview','Sega Saturn Preview Vol. 1'])
   expect(titles.has(gone),`${gone} should not be in the catalog`).toBe(false);
  for(const kept of ['Pandemonium!','Daytona USA C.C.E. Net Link Edition'])
   expect(titles.has(kept),`${kept} should still be in the catalog`).toBe(true);
 });
 /**
  * Every N64 cover URL 404'd while the assertion above passed, because that
  * assertion checks the thumbnail folder and the defect was in the filename.
  * The importer stripped only `.cue` from the dump name, which is right for a
  * Redump disc and leaves `... (USA).n64` on every cartridge, producing
  * `... (USA).n64.png`. Libretro names a thumbnail after the release, never
  * after the ROM file, so a cover name carrying an image extension is broken
  * for a whole platform rather than for a few odd titles.
  */
 it('never carries a ROM or disc extension in a cover name',()=>{
  const carrying=games.filter(g=>/\.(cue|chd|iso|bin|n64|z64|v64|nes|sfc|smc|md|gen|gg|sms|gb|gbc|gba|pce|32x)$/i.test(g.coverName??''));
  expect(carrying.map(g=>`${g.platform} ${g.coverName}`)).toEqual([]);
 });
 /** A seeded cover URL must be built from the game's own console. */
 it('seeds each platform its own Libretro thumbnail system',()=>{
  const systems:Record<string,string>={PS1:'Sony%20-%20PlayStation',N64:'Nintendo%20-%20Nintendo%2064',SAT:'Sega%20-%20Saturn'};
  for(const g of games){
   if(!g.cover?.startsWith('https://thumbnails.libretro.com/')) continue;
   expect(g.cover,`${g.platform} ${g.title}`).toContain(`/${systems[g.platform]}/`);
  }
 });
 /**
  * Redump lists cheat cartridges, magazine cover discs and bonus albums because
  * they are real PlayStation discs. A catalog for finding something to play
  * should not: one of them was surfacing inside a curator shelf.
  */
 it('carries no disc that is not a game to play',()=>{
  for(const g of games){
   expect(g.title,'cheat device in catalog').not.toMatch(/^(GameShark|Code ?Breaker|PS-X-Change|Action Replay)\b/i);
   expect(g.title,'demo disc in catalog').not.toMatch(/\bDemo (CD|Disc)\b|\bInteractive (CD )?Sampler\b|\bCollector'?s CD\b|\bJampack\b/i);
   expect(g.coverName??'','bonus disc in catalog').not.toMatch(/\(Bonus( PlayStation)? Disc\)/i);
  }
  // Promo and bundled sampler discs that share no pattern and are named out.
  for(const title of ['Pizza Hut Disc 1','Pizza Hut Disc 2','PlayStation Picks',"Toys 'R' Us: Attack of the Killer Demos!"])
   expect(games.some(g=>g.title===title),`${title} is still in the catalog`).toBe(false);
 });
 /**
  * The unanchored version of that filter deletes real games: `underground`
  * takes Medal of Honor with it, `trial` matches inside "Extra-Terrestrial",
  * and `xplorer` matches Barbie and Dora. Removing 79 discs is worth nothing if
  * it also removes one game somebody wanted, so the near misses are pinned.
  */
 it('keeps the games an unanchored exclusion would have eaten',()=>{
  for(const title of ['Medal of Honor: Underground','Professional Underground League of Pain','Dora the Explorer: Barnyard Buddies','Barbie: Explorer','E.T. the Extra-Terrestrial: Interplanetary Mission','Equestrian Showcase','Persona 2: Eternal Punishment',
   // A bonus disc, but a playable game rather than a demo reel or an album.
   'Ridge Racer Bonus Turbo Mode Disc'])
   expect(games.some(g=>g.title===title),`${title} was removed`).toBe(true);
 });
 it('keeps this expansion to official English-language releases',()=>{const ids=new Set(ps1Expansion.filter(([, , ,region])=>region!=='Japan').map(([id])=>id));for(const g of games.filter(g=>ids.has(g.id)))expect(g.region).not.toBe('Japan')});
 it('keeps an explicit lightweight cover fallback for every USA title',()=>{for(const g of games.filter(g=>g.region==='USA'))expect(g.cover).toMatch(/^https:\/\/thumbnails\.libretro\.com\//)});
 it('keeps Japan-only English records explicit',()=>{for(const g of games.filter(g=>g.region==='Japan'&&g.translation))expect(g.translation?.base).toBeTruthy()});
 it('keeps every outbound link stateful',()=>{for(const g of games)for(const l of g.links)expect(['verified','unverified','stale','dead']).toContain(l.state)});
 it('never presents an unsourced editorial quote',()=>{expect(games.every(g=>!g.curatorNote)).toBe(true)});
 it('keeps USA catalog copy traceable or explicitly absent',()=>{for(const g of games.filter(g=>g.region==='USA'))expect(!g.description||g.descriptionSource?.url).toBeTruthy()});
 /**
  * Translation search terms were hand-written per record and drifted from the
  * titles they were supposed to search for, so every one of these is a bug that
  * shipped: an over-specific subtitle that matched nothing, or a platform tag no
  * database title contains.
  */
 it('reduces a translation search to the term the database indexes',()=>{
  expect(translationSearchTerm('Germs: Nerawareta Machi')).toBe('Germs');
  expect(translationSearchTerm('Baroque')).toBe('Baroque');
  expect(translationSearchTerm('Kowloon’s Gate')).toBe("Kowloon's Gate");
  expect(translationSearchTerm('Linda³ Again')).toBe('Linda3 Again');
  expect(translationSearchTerm('Rising Zan - The Samurai Gunman')).toBe('Rising Zan');
  expect(translationSearchTerm('Harmful Park (Japan)')).toBe('Harmful Park');
 });
 it('never sends a platform tag or trailing subtitle as a translation query',()=>{
  for(const g of games.filter(g=>g.translation)){
   const url=new URL(g.translation!.url);
   const term=url.searchParams.get('queryString')??'';
   expect(url.origin).toBe('https://romhack.ing');
   expect(url.pathname).toBe('/search/translation');
   expect(term).not.toMatch(/\b(PS1|PSX|PlayStation)\b/i);
   expect(term).not.toMatch(/[:—–]|\s-\s/);
   expect(term.length).toBeGreaterThan(0);
   // The term must come from the record's own title, so it cannot drift again.
   expect(translationSearchTerm(g.title)).toBe(term);
  }
 });
 it('uses romhack.ing’s own translation search rather than the closed ROMhacking.net site search',()=>{
  expect(translationSearchUrl('Germs')).toBe('https://romhack.ing/search/translation?queryString=Germs');
 });
 /**
  * OpenVGDB alone supplied a year for 202 of 1,462 USA records and a developer
  * for the same 202, so most of the catalog rendered "0 ·" under its title and
  * "Unknown" in its details. These floors sit under the measured LaunchBox
  * coverage; they fail if a future import silently reverts to a thin source.
  */
 it('carries human-facing metadata for nearly the whole USA base',()=>{
  const usa=games.filter(g=>g.region==='USA');
  const share=(has:(g:typeof usa[number])=>boolean)=>usa.filter(has).length/usa.length;
  expect(share(g=>g.year>0)).toBeGreaterThan(0.95);
  expect(share(g=>g.genres.length>0)).toBeGreaterThan(0.9);
  expect(share(g=>Boolean(g.description))).toBeGreaterThan(0.9);
  expect(share(g=>g.developer!=='Unknown')).toBeGreaterThan(0.9);
  expect(share(g=>g.players!=='Unknown')).toBeGreaterThan(0.9);
 });
 /**
  * A record the providers know nothing about must read as blank. The previous
  * subtitle emitted the year and its separator unconditionally, which is how a
  * missing field reached the grid looking like a release year of zero.
  */
 it('never renders a missing year as data',()=>{
  for(const g of games)expect(metaLine(g)).not.toMatch(/(^|\s)0(\s|$)/);
  expect(metaLine({...games[0],year:0,genres:['Puzzle']})).toBe('Puzzle');
  expect(metaLine({...games[0],year:0,genres:[]})).toBe('');
  expect(metaLine({...games[0],year:1996,genres:['Action','Driving']})).toBe('1996 · Action / Driving');
 });
 /**
  * Two providers feed one genre filter. Unmapped provider terms would quietly
  * add near-duplicate dropdown entries ("Role-Playing" beside "RPG") and free
  * text such as "Snow / Water", so the vocabulary stays small and closed.
  */
 it('folds both providers into one closed genre vocabulary',()=>{
  const vocabulary=new Set(games.flatMap(g=>g.genres));
  expect(vocabulary.size).toBeLessThanOrEqual(40);
  for(const genre of vocabulary){
   expect(genre).not.toMatch(/[/,;]/);
   expect(genre).not.toBe('Role-Playing');
   expect(genre).not.toBe('Platform');
  }
  expect(vocabulary.has('RPG')).toBe(true);
  expect(vocabulary.has('Platformer')).toBe(true);
 });
 it('builds replaceable discovery shelves',()=>{const low=createCuratedShelves(()=>0);const high=createCuratedShelves(()=>0.999);expect(low).toHaveLength(4);expect(high).toHaveLength(4);expect(low.map(s=>s.title)).not.toEqual(high.map(s=>s.title));for(const shelf of [...low,...high])expect(shelf.ids.length).toBeGreaterThan(0)});
});
