import { describe, expect, it } from 'vitest';
import { games } from './catalog';
describe('catalog invariants',()=>{
 it('contains 100 unique canonical games',()=>{expect(games).toHaveLength(100);expect(new Set(games.map(g=>g.id)).size).toBe(100)});
 it('keeps an explicit lightweight cover fallback for every expanded title',()=>{for(const g of games.slice(30))expect(g.cover).toMatch(/^https:\/\/thumbnails\.libretro\.com\//)});
 it('keeps Japan-only English records explicit',()=>{for(const g of games.filter(g=>g.region==='Japan'&&g.translation))expect(g.translation?.base).toBeTruthy()});
 it('keeps every outbound link stateful',()=>{for(const g of games)for(const l of g.links)expect(['verified','unverified','stale','dead']).toContain(l.state)});
});
