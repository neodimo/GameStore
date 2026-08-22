import { describe, expect, it } from 'vitest';
import { games } from './catalog';
describe('catalog invariants',()=>{
 it('contains 30 unique canonical games',()=>{expect(games).toHaveLength(30);expect(new Set(games.map(g=>g.id)).size).toBe(30)});
 it('keeps Japan-only English records explicit',()=>{for(const g of games.filter(g=>g.region==='Japan'&&g.translation))expect(g.translation?.base).toBeTruthy()});
 it('keeps every outbound link stateful',()=>{for(const g of games)for(const l of g.links)expect(['verified','unverified','stale','dead']).toContain(l.state)});
});
