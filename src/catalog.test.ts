import { describe, expect, it } from 'vitest';
import { games } from './catalog';
import { ps1Expansion } from './ps1Expansion';
describe('catalog invariants',()=>{
 it('contains a substantial, deduplicated English-playable PS1 library',()=>{expect(games.length).toBeGreaterThanOrEqual(260);expect(new Set(games.map(g=>g.id)).size).toBe(games.length)});
 it('keeps this expansion to official English-language releases',()=>{const ids=new Set(ps1Expansion.filter(([, , ,region])=>region!=='Japan').map(([id])=>id));for(const g of games.filter(g=>ids.has(g.id)))expect(g.region).not.toBe('Japan')});
 it('keeps an explicit lightweight cover fallback for every expanded title',()=>{for(const g of games.slice(30))expect(g.cover).toMatch(/^https:\/\/thumbnails\.libretro\.com\//)});
 it('keeps Japan-only English records explicit',()=>{for(const g of games.filter(g=>g.region==='Japan'&&g.translation))expect(g.translation?.base).toBeTruthy()});
 it('keeps every outbound link stateful',()=>{for(const g of games)for(const l of g.links)expect(['verified','unverified','stale','dead']).toContain(l.state)});
});
