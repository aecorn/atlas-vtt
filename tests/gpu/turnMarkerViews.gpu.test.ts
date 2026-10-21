import { describe, expect, it } from 'vitest';
import { playerViewScenes, SIZE, type PlayerViewScene } from '../helpers/playerViewScene';
import { forgetObsidianAccentColor } from '../../src/app/pixi/utils/colorUtils';
import { createDefaultInitiativeState, type InitiativeEntry } from '../../src/app/types/initiativeTypes';

const { scene: createScene } = playerViewScenes();

/** Pixels of the accent (#7f6df2) around (x, y): the marker's ring. */
function accentAround(pixels: Uint8ClampedArray, x: number, y: number, reach = 30): number {
  let count = 0;
  for (let row = Math.max(0, y - reach); row < Math.min(SIZE, y + reach); row++) {
    for (let column = Math.max(0, x - reach); column < Math.min(SIZE, x + reach); column++) {
      const i = (row * SIZE + column) * 4;
      if (pixels[i + 2]! - pixels[i]! > 60 && pixels[i + 2]! > 150) count++;
    }
  }
  return count;
}

const entry = (tokenId: string, order: number, isActive: boolean): InitiativeEntry => ({
  id: `e-${tokenId}`, tokenId, name: tokenId, initiative: 10, initiativeModifier: 0, imagePath: '', isActive, isNPC: true, order,
});

/** A fight in which the ogre has the turn, its marker grown in. */
async function fight(): Promise<PlayerViewScene> {
  document.body.style.setProperty('--interactive-accent', '#7f6df2');
  forgetObsidianAccentColor();
  const scene = await createScene();
  await scene.add({ id: 'ogre', x: 180, y: 180 });
  scene.store.setState({
    initiativeTrackerOpen: true,
    initiative: { ...createDefaultInitiativeState(), isActive: true, round: 1, entries: [entry('ogre', 0, true)] },
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  scene.app.ticker.update(performance.now());
  return scene;
}

describe('the turn marker in the views of the canvas', () => {
  it('shows in session view and the peek only where players are shown their initiative list', async () => {
    const scene = await fight();
    expect(accentAround(scene.canvas(), 180, 180)).toBeGreaterThan(20);

    // Session view, the list shown to players: the marker stays, and the players' frame has it too
    scene.store.setState({ isGMView: false });
    expect(accentAround(scene.canvas(), 180, 180)).toBeGreaterThan(20);
    expect(accentAround(scene.frame(), 180, 180)).toBeGreaterThan(20);

    // The GM closes the tracker: players have no list, the canvas in their view no marker
    scene.store.setState({ initiativeTrackerOpen: false });
    expect(accentAround(scene.canvas(), 180, 180)).toBe(0);
    expect(accentAround(scene.frame(), 180, 180)).toBe(0);
    scene.store.setState({ initiativeTrackerOpen: true });
    expect(accentAround(scene.canvas(), 180, 180)).toBeGreaterThan(20);

    // The player view's switch hides the list from players, and so the marker
    scene.settings.setLocalPlayerViewSettings({ showInitiative: false });
    expect(accentAround(scene.canvas(), 180, 180)).toBe(0);

    // Back in the GM's view the GM sees it again; held for a peek it goes
    scene.store.setState({ isGMView: true });
    expect(accentAround(scene.canvas(), 180, 180)).toBeGreaterThan(20);
    scene.peek(true);
    expect(accentAround(scene.canvas(), 180, 180)).toBe(0);
    scene.peek(false);
    expect(accentAround(scene.canvas(), 180, 180)).toBeGreaterThan(20);
    // A picture of the scene never shows it
    expect(accentAround(scene.thumbnail(), 180, 180)).toBe(0);
  });
});
