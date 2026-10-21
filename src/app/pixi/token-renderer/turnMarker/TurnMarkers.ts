import { Container, Graphics, type Ticker } from 'pixi.js';
import { turnKey, currentTurn, turnTokenIds } from '../../../initiative/turnHolders';
import type { TokenEntity } from '../../../types';
import type { GridState } from '../../../types/gridTypes';
import type { InitiativeState } from '../../../types/initiativeTypes';
import type { TokenSeen } from '../../../vision/measureOrigin';
import { mapTokens, sceneTokens, type TokenHolder } from '../../../tokens/offMap';
import { MAP_LAYER_Z } from '../../mapLayerOrder';
import type { LayerVisibility } from '../../playerSafeFrame';
import { cssColorToHexNumber, getObsidianAccentColor } from '../../utils/colorUtils';
import { destroyTree } from '../../utils/destroyTree';
import { ValueTransition } from '../../utils/ValueTransition';
import { getTokenRingOuterDiameter } from '../tokenRingMetrics';
import { computeTokenStrokeWidth, restingTokenUIScale } from '../tokenSizing';
import type { TokenGroupContainer } from '../types';
import { MARKER_GROW_FROM, MARKER_GROW_MS, turnMarkerStrokes } from './turnMarkerShape';

/**
 * Curves are drawn this many times larger and scaled down: PIXI builds a circle from a number of
 * straight pieces that follows its radius, and a ring zoomed in on screen would show corners.
 */
const DRAW_SCALE = 8;

const readAccent = (): number => cssColorToHexNumber(getObsidianAccentColor());

/** What the markers read of a view's store. */
export interface TurnMarkerState {
  readonly initiative: Pick<InitiativeState, 'isActive' | 'round' | 'entries' | 'sides'>;
  readonly objects: TokenHolder<TokenEntity>;
  readonly grid?: Pick<GridState, 'size'> | null | undefined;
  readonly isMapLoading?: boolean | undefined;
}

export interface TurnMarkerDeps {
  /** The world the markers stand in (the viewport). */
  readonly parent: Container;
  getState(): TurnMarkerState;
  subscribe(listener: (state: TurnMarkerState) => void): () => void;
  /** The sprite of a token on the map, or null for one without (beside the map, not loaded yet). */
  spriteOf(tokenId: string): TokenGroupContainer | null;
  /** The ticker the markers follow their tokens by. */
  ticker(): Ticker | null;
  reducedMotion(): boolean;
  /** The entry ids of the defeated combatants, which hold no turn of their side; none without. */
  defeated?(state: TurnMarkerState): ReadonlySet<string>;
}

/** The marker on one token: the drawn rings in a container that grows in and follows the token. */
class TurnMarker {
  readonly view = new Container({ label: 'turnMarker', eventMode: 'none' });
  private readonly rings = new Graphics();
  private drawn = '';
  /** How far the marker has grown in, 0 to 1: its scale and its opacity follow it. */
  growth = 1;
  private readonly grow: ValueTransition;

  constructor() {
    this.rings.scale.set(1 / DRAW_SCALE);
    this.view.addChild(this.rings);
    this.grow = new ValueTransition(1, MARKER_GROW_MS, (value) => {
      this.growth = value;
      this.view.scale.set(MARKER_GROW_FROM + (1 - MARKER_GROW_FROM) * value);
    });
  }

  /** Draws the rings for a token whose outer edge lies `outerRadius` from its centre; nothing when unchanged. */
  draw(outerRadius: number, unit: number, accent: number, force = false): void {
    const key = `${outerRadius}|${unit}|${accent}`;
    if (!force && key === this.drawn) return;
    this.drawn = key;
    this.rings.clear();
    for (const stroke of turnMarkerStrokes(outerRadius, unit)) {
      this.rings.circle(0, 0, stroke.radius * DRAW_SCALE).stroke({
        width: stroke.width * DRAW_SCALE,
        color: stroke.ink === 'accent' ? accent : 0x000000,
        alpha: stroke.alpha,
      });
    }
  }

  growIn(animate: boolean): void {
    if (!animate) {
      this.grow.jumpTo(1);
      return;
    }
    this.grow.jumpTo(0);
    this.grow.animateTo(1);
  }

  /** Stands where `sprite` stands, shown with it, as translucent as it is and as far grown in as it is. */
  follow(sprite: TokenGroupContainer | null): void {
    const visible = sprite !== null && sprite.visible;
    if (this.view.visible !== visible) this.view.visible = visible;
    if (!sprite) return;
    this.view.position.copyFrom(sprite.position);
    const alpha = sprite.alpha * this.growth;
    if (this.view.alpha !== alpha) this.view.alpha = alpha;
  }

  destroy(): void {
    this.grow.cancel();
    destroyTree(this.view);
  }
}

/**
 * The marker on each token that holds the turn of a running fight (`turnTokenIds`): drawn above
 * the lighting and below the tokens' bars, it grows in as the turn comes (not with reduced motion)
 * and then stands still; the ticker only moves it with its token. A combatant beside the map has
 * none. What the players see of it is `playerLayers`, and pictures of the scene show none.
 */
export class TurnMarkers {
  /** The layer every marker stands in. */
  readonly layer = new Container({ label: 'turnMarkers', eventMode: 'none', zIndex: MAP_LAYER_Z.turn });
  private readonly markers = new Map<string, TurnMarker>();
  private readonly unsubscribe: () => void;
  private following: Ticker | null = null;
  private shownKey: string | null = null;
  private last: TurnMarkerState | null = null;
  /** The theme's accent, read when the turn changes or the theme does: never on a frame, where reading styles costs a layout. */
  private accent = 0;

  constructor(private readonly deps: TurnMarkerDeps) {
    deps.parent.addChild(this.layer);
    this.unsubscribe = deps.subscribe((state) => this.sync(state));
    this.sync(deps.getState(), false);
  }

  /** The tokens that carry a marker now. */
  get tokenIds(): string[] {
    return [...this.markers.keys()];
  }

  /** Follows the tokens by the ticker there is now (the app's, once the renderer has one). */
  followTicker(): void {
    if (this.markers.size > 0) this.startFollowing();
  }

  /** Works the markers out again: the collection's resources, which say who is defeated, may have changed. */
  refresh(): void {
    this.last = null;
    this.sync(this.deps.getState());
  }

  /**
   * Whether the canvas shows the markers. While it shows the players' view (session view, the peek,
   * the palette's player mode) it shows them only where the players are shown their initiative list.
   */
  showOnCanvas(shown: boolean): void {
    if (this.layer.visible !== shown) this.layer.visible = shown;
  }

  /** Draws every marker anew: the theme's accent may have changed. */
  refreshTheme(): void {
    this.accent = readAccent();
    for (const [tokenId, marker] of this.markers) this.drawMarker(tokenId, marker, true);
  }

  /**
   * The markers in the players' frame: only on tokens they see (`seen`: not hidden, seen, not under
   * fog), and none while their initiative list is not shown (`shown`). A marker growing in fades in
   * for them as it does on the canvas; the GM's translucency of a hidden token is no concern of theirs.
   */
  playerLayers(seen: TokenSeen, shown: boolean): LayerVisibility[] {
    return [
      { layer: this.layer, visible: shown },
      ...[...this.markers].map(([tokenId, marker]) => ({ layer: marker.view, visible: shown && seen(tokenId), alpha: marker.growth })),
    ];
  }

  /** A picture of the scene shows no marker. */
  pictureLayers(): LayerVisibility[] {
    return [{ layer: this.layer, visible: false }];
  }

  destroy(): void {
    this.unsubscribe();
    this.stopFollowing();
    for (const marker of this.markers.values()) marker.destroy();
    this.markers.clear();
    destroyTree(this.layer);
  }

  private sync(state: TurnMarkerState, animate = true): void {
    const previous = this.last;
    this.last = state;
    if (previous && previous.initiative === state.initiative && sceneTokens(previous.objects) === sceneTokens(state.objects) && previous.grid === state.grid) return;
    const turn = currentTurn(state.initiative);
    const key = turn ? turnKey(turn) : null;
    // Sides are read off every combatant's token; only those on the map carry a marker
    const onMap = mapTokens(state.objects);
    const defeated = this.deps.defeated?.(state);
    const ids = new Set(turnTokenIds(state.initiative, sceneTokens(state.objects), defeated).filter((tokenId) => onMap[tokenId] !== undefined));
    const turnMoved = key !== this.shownKey;
    this.shownKey = key;
    if (turnMoved) this.accent = readAccent();
    const grow = animate && !state.isMapLoading && !this.deps.reducedMotion();
    for (const [tokenId, marker] of this.markers) {
      if (ids.has(tokenId)) continue;
      marker.destroy();
      this.markers.delete(tokenId);
    }
    for (const tokenId of ids) {
      let marker = this.markers.get(tokenId);
      const isNew = marker === undefined;
      if (!marker) {
        marker = new TurnMarker();
        this.markers.set(tokenId, marker);
        this.layer.addChild(marker.view);
      }
      this.drawMarker(tokenId, marker);
      if (isNew || turnMoved) marker.growIn(grow);
      marker.follow(this.deps.spriteOf(tokenId));
    }
    if (this.markers.size > 0) this.startFollowing();
    else this.stopFollowing();
  }

  private drawMarker(tokenId: string, marker: TurnMarker, force = false): void {
    const state = this.deps.getState();
    const gridSize = state.grid?.size ?? 70;
    const token = mapTokens(state.objects)[tokenId];
    const size = this.deps.spriteOf(tokenId)?.tokenSize ?? 0;
    if (!token || !(size > 0)) return;
    const outer = token.showRing === false ? size : getTokenRingOuterDiameter(size, computeTokenStrokeWidth(gridSize));
    marker.draw(outer / 2, restingTokenUIScale(gridSize), this.accent, force);
  }

  /** Each frame the markers take their tokens' places, visibility and size; PIXI renders only what changed. */
  private readonly followAll = (): void => {
    for (const [tokenId, marker] of this.markers) {
      this.drawMarker(tokenId, marker);
      marker.follow(this.deps.spriteOf(tokenId));
    }
  };

  private startFollowing(): void {
    const ticker = this.deps.ticker();
    if (this.following === ticker) return;
    this.stopFollowing();
    ticker?.add(this.followAll);
    this.following = ticker;
  }

  private stopFollowing(): void {
    this.following?.remove(this.followAll);
    this.following = null;
  }
}
