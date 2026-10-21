import { Container, Ticker } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnMarkers, type TurnMarkerState } from '../../src/app/pixi/token-renderer/turnMarker/TurnMarkers';
import { MAP_LAYER_Z } from '../../src/app/pixi/mapLayerOrder';
import { TOKEN_UI_Z_INDEX } from '../../src/app/pixi/TokenControlsUI';
import { turnMarkerStrokes, MARKER_REACH_UNITS } from '../../src/app/pixi/token-renderer/turnMarker/turnMarkerShape';
import type { TokenGroupContainer } from '../../src/app/pixi/token-renderer/types';
import type { TokenEntity } from '../../src/app/types';
import { createDefaultInitiativeState, type InitiativeEntry, type InitiativeState } from '../../src/app/types/initiativeTypes';

const token = (id: string, changes: Partial<TokenEntity> = {}): TokenEntity => ({ id, kind: 'token', x: 100, y: 100, imagePath: '', ...changes } as TokenEntity);
const entry = (tokenId: string, order: number, changes: Partial<InitiativeEntry> = {}): InitiativeEntry => ({
  id: `e-${tokenId}`, tokenId, name: tokenId, initiative: 10, initiativeModifier: 0, imagePath: '', isActive: false, isNPC: true, order, ...changes,
});

function sprite(x: number, y: number): TokenGroupContainer {
  const group = new Container() as TokenGroupContainer;
  group.tokenSize = 62;
  group.position.set(x, y);
  return group;
}

/** A store and the markers over it; `sprites` are the tokens on the map (one beside the map has none). */
function setup(initiative: InitiativeState, tokens: Record<string, TokenEntity>, sprites: Record<string, TokenGroupContainer>, reduced = true, defeated: ReadonlySet<string> = new Set()) {
  let state: TurnMarkerState = { initiative, objects: { tokens }, grid: { size: 70 }, isMapLoading: false };
  const listeners = new Set<(next: TurnMarkerState) => void>();
  const world = new Container();
  const ticker = new Ticker();
  const markers = new TurnMarkers({
    parent: world,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    spriteOf: (id) => sprites[id] ?? null,
    ticker: () => ticker,
    reducedMotion: () => reduced,
    defeated: () => defeated,
  });
  const set = (changes: Partial<TurnMarkerState>): void => {
    state = { ...state, ...changes };
    for (const listener of listeners) listener(state);
  };
  const follow = (): void => ticker.update(performance.now() + 16);
  return { markers, world, set, follow, get: () => state };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const order = (active: string): InitiativeState => ({
  ...createDefaultInitiativeState(), isActive: true, round: 1,
  entries: ['hero', 'ogre', 'ghost', 'away'].map((id, index) => entry(id, index, { isActive: id === active })),
});
const tokens = { hero: token('hero', { vision: { enabled: true } } as Partial<TokenEntity>), ogre: token('ogre'), ghost: token('ghost', { isHidden: true }), away: token('away', { offMap: true } as Partial<TokenEntity>) };
const sprites = { hero: sprite(100, 100), ogre: sprite(300, 100), ghost: sprite(500, 100) };

describe('the turn marker', () => {
  it('stands above the lighting and below the tokens\' bars', () => {
    expect(MAP_LAYER_Z.turn).toBeGreaterThan(90);
    expect(MAP_LAYER_Z.turn).toBeLessThan(TOKEN_UI_Z_INDEX);
    const { markers } = setup(order('ogre'), tokens, sprites);
    cleanups.push(() => markers.destroy());
    expect(markers.layer.zIndex).toBe(MAP_LAYER_Z.turn);
  });

  it('marks the token with the turn and moves on with the turn; none outside a fight', () => {
    const { markers, set } = setup(order('ogre'), tokens, sprites);
    cleanups.push(() => markers.destroy());
    expect(markers.tokenIds).toEqual(['ogre']);
    set({ initiative: order('hero') });
    expect(markers.tokenIds).toEqual(['hero']);
    set({ initiative: { ...order('hero'), isActive: false } });
    expect(markers.tokenIds).toEqual([]);
  });

  it('marks every acting combatant of the side with the turn, and of tied sides', () => {
    const sides = { ...order('none'), sides: { first: 'players' as const, active: 'opponents' as const } };
    const { markers, set } = setup(sides, tokens, sprites);
    cleanups.push(() => markers.destroy());
    // The combatant beside the map acts with its side but carries no marker
    expect(markers.tokenIds).toEqual(['ogre', 'ghost']);
    set({ initiative: { ...sides, sides: { ...sides.sides, roll: '1d6', rolls: { 1: { players: 2, opponents: 2 } } } } });
    expect(markers.tokenIds.sort()).toEqual(['ghost', 'hero', 'ogre']);
  });

  it('follows its token while it moves, and shows with it', () => {
    const { markers, follow } = setup({ ...order('none'), sides: { first: 'players', active: 'opponents' } }, tokens, sprites);
    cleanups.push(() => markers.destroy());
    follow();
    const views = new Map(markers.layer.children.map((child, index) => [markers.tokenIds[index], child]));
    sprites.ogre.position.set(320, 140);
    follow();
    expect([views.get('ogre')?.x, views.get('ogre')?.y]).toEqual([320, 140]);
    // The canvas hides a token (session view, out of the players' sight): its marker goes with it
    sprites.ogre.visible = false;
    follow();
    expect(views.get('ogre')?.visible).toBe(false);
    sprites.ogre.visible = true;
    // A hidden token in the GM's view is translucent, and so is its marker
    sprites.ghost.alpha = 0.5;
    follow();
    expect(views.get('ghost')?.alpha).toBe(0.5);
    expect(views.has('away')).toBe(false);
  });

  it('shows players only the markers of tokens they see, while their list is shown', () => {
    const { markers } = setup({ ...order('none'), sides: { first: 'players', active: 'opponents' } }, tokens, sprites);
    cleanups.push(() => markers.destroy());
    const seen = (id: string): boolean => id === 'ogre';
    const visible = markers.playerLayers(seen, true).map((layer) => layer.visible);
    // The layer, then the ogre's and the ghost's markers
    expect(visible).toEqual([true, true, false]);
    expect(markers.playerLayers(seen, false).every((layer) => !layer.visible)).toBe(true);
    // A picture of the scene shows none
    expect(markers.pictureLayers()).toEqual([{ layer: markers.layer, visible: false }]);
  });

  it('leaves the defeated of the side with the turn without a marker', () => {
    const sides = { ...order('none'), sides: { first: 'players' as const, active: 'opponents' as const } };
    const { markers } = setup(sides, tokens, sprites, true, new Set(['e-ogre']));
    cleanups.push(() => markers.destroy());
    expect(markers.tokenIds).toEqual(['ghost']);
  });

  it('hides from the canvas where the players are not shown their list, and works the turn out again on request', () => {
    const defeated = new Set<string>();
    const sides = { ...order('none'), sides: { first: 'players' as const, active: 'opponents' as const } };
    const { markers } = setup(sides, tokens, sprites, true, defeated);
    cleanups.push(() => markers.destroy());
    markers.showOnCanvas(false);
    expect(markers.layer.visible).toBe(false);
    markers.showOnCanvas(true);
    expect(markers.layer.visible).toBe(true);
    // The collection's resources changed: the ogre is defeated now
    defeated.add('e-ogre');
    markers.refresh();
    expect(markers.tokenIds).toEqual(['ghost']);
  });

  it('grows in as the turn comes, unless motion is reduced, and then stands still', () => {
    // The grow runs on animation frames: here they wait to be called
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('window', { requestAnimationFrame: (run: FrameRequestCallback) => frames.push(run), cancelAnimationFrame: () => undefined });
    cleanups.push(() => vi.unstubAllGlobals());
    const { markers, set } = setup(order('ogre'), tokens, sprites, false);
    cleanups.push(() => markers.destroy());
    // The first look at a running fight draws it as it stands
    expect(markers.layer.children[0]?.scale.x).toBe(1);
    set({ initiative: order('hero') });
    expect(markers.layer.children[0]?.scale.x).toBeLessThan(1);
    // Players see it fade in as the canvas does
    const [, growing] = markers.playerLayers(() => true, true);
    expect(growing?.alpha).toBe(0);
    vi.spyOn(performance, 'now').mockReturnValue(Number.MAX_SAFE_INTEGER);
    cleanups.push(() => vi.restoreAllMocks());
    frames.shift()?.(0);
    expect(markers.layer.children[0]?.scale.x).toBe(1);
    expect(markers.playerLayers(() => true, true)[1]?.alpha).toBe(1);
    expect(frames).toEqual([]);
    const reduced = setup(order('ogre'), tokens, sprites, true);
    cleanups.push(() => reduced.markers.destroy());
    reduced.set({ initiative: order('hero') });
    expect(reduced.markers.layer.children[0]?.scale.x).toBe(1);
  });

  it('rings the token outside its own ring, as the look spec gives it', () => {
    const strokes = turnMarkerStrokes(35, 1);
    expect(strokes.map((stroke) => [stroke.radius, stroke.width, stroke.ink])).toEqual([[37.5, 1, 'dark'], [39.5, 3, 'accent'], [44, 6, 'accent']]);
    const halo = strokes[2]!;
    expect(halo.radius + halo.width / 2).toBe(35 + MARKER_REACH_UNITS);
  });
});
