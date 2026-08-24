import { describe, expect, it } from 'vitest';
import { createCuratedShelves, games } from './catalog';
import { ps1Expansion } from './ps1Expansion';
describe('catalog invariants',()=>{
 it('contains the full USA retail base plus the eligible regional catalog',()=>{expect(games.filter(g=>g.region==='USA').length).toBeGreaterThanOrEqual(1400);expect(new Set(games.map(g=>g.id)).size).toBe(games.length)});
 it('keeps this expansion to official English-language releases',()=>{const ids=new Set(ps1Expansion.filter(([, , ,region])=>region!=='Japan').map(([id])=>id));for(const g of games.filter(g=>ids.has(g.id)))expect(g.region).not.toBe('Japan')});
 it('keeps an explicit lightweight cover fallback for every USA title',()=>{for(const g of games.filter(g=>g.region==='USA'))expect(g.cover).toMatch(/^https:\/\/thumbnails\.libretro\.com\//)});
 it('keeps Japan-only English records explicit',()=>{for(const g of games.filter(g=>g.region==='Japan'&&g.translation))expect(g.translation?.base).toBeTruthy()});
 it('keeps every outbound link stateful',()=>{for(const g of games)for(const l of g.links)expect(['verified','unverified','stale','dead']).toContain(l.state)});
 it('never presents an unsourced editorial quote',()=>{expect(games.every(g=>!g.curatorNote)).toBe(true)});
 it('keeps USA catalog copy traceable or explicitly absent',()=>{for(const g of games.filter(g=>g.region==='USA'))expect(!g.description||g.descriptionSource?.url).toBeTruthy()});
 it('builds replaceable discovery shelves',()=>{const low=createCuratedShelves(()=>0);const high=createCuratedShelves(()=>0.999);expect(low).toHaveLength(4);expect(high).toHaveLength(4);expect(low.map(s=>s.title)).not.toEqual(high.map(s=>s.title));for(const shelf of [...low,...high])expect(shelf.ids.length).toBeGreaterThan(0)});
});
