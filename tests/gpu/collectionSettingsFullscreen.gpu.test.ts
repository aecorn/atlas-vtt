import '../setup/obsidianDom';
import { createElement } from 'react';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import css from '../../styles/main.scss?inline';
import { createInMemoryApp } from '../mocks/inMemoryVault';
import { withStatblockEditor } from '../mocks/experimentalFeatures';
import { AtlasUIContext } from '../../src/app/react/root/AtlasUIContext';
import { CollectionSettingsModal, type CollectionSettingsTab } from '../../src/app/react/components/CollectionSettingsModal';
import { AssetService } from '../../src/app/services/AssetService';
import { TABLE_FILES, TABLES_THEME } from './randomTablesHarness';

// The dialog reaches services that load Node's events module.
vi.mock('events', async () => import('eventemitter3'));

const OVERLAY_MARGIN = 32;
const modal = (): HTMLElement => document.querySelector<HTMLElement>('.atlas-collection-settings-modal')!;
const box = (element: Element): DOMRect => element.getBoundingClientRect();

async function open(tab: CollectionSettingsTab, statblockEditor: boolean): Promise<void> {
  const { app } = createInMemoryApp({ files: TABLE_FILES });
  if (statblockEditor) withStatblockEditor(app);
  AssetService.resetInstance();
  const assets = AssetService.getInstance(app);
  await assets.initialize();
  render(createElement(AtlasUIContext.Provider, { value: { app, view: null, pixiApp: null, renderer: null } },
    createElement(CollectionSettingsModal, { isOpen: true, collectionId: assets.getDefaultCollectionId(), initialTab: tab, onClose: () => undefined })));
  await expect.poll(() => modal()).not.toBeNull();
}

/** The collection settings dialog fills the window, forms keep a readable width, the Resources tab takes all of it. */
describe('the collection settings dialog, fullscreen', () => {
  const style = document.createElement('style');
  style.textContent = TABLES_THEME + css;

  beforeAll(() => { MotionGlobalConfig.skipAnimations = true; });
  afterAll(() => { MotionGlobalConfig.skipAnimations = false; });
  beforeEach(async () => {
    document.body.className = 'theme-dark';
    document.head.append(style);
    await page.viewport(1440, 900);
  });
  afterEach(() => {
    cleanup();
    style.remove();
  });

  it('fills the window but for the overlay\'s margin, a form centred at a readable width', async () => {
    await open('grid', true);
    // Once the window has grown in
    await expect.poll(() => Math.round(box(modal()).left)).toBe(OVERLAY_MARGIN);
    const window = box(modal());
    expect(window.left).toBeCloseTo(OVERLAY_MARGIN, 0);
    expect(window.top).toBeCloseTo(OVERLAY_MARGIN, 0);
    expect(document.documentElement.clientWidth - window.right).toBeCloseTo(OVERLAY_MARGIN, 0);
    expect(document.documentElement.clientHeight - window.bottom).toBeCloseTo(OVERLAY_MARGIN, 0);
    const content = box(modal().querySelector('.atlas-collection-settings-content')!);
    const form = box(modal().querySelector('.atlas-collection-settings-page')!);
    expect(form.width).toBe(760);
    expect(form.left - content.left).toBeCloseTo(content.right - form.right, -1);
  });

  it('gives the Resources tab the whole width, the recovery pane beside the sockets, with the statblock editor on', async () => {
    await open('resources', true);
    await expect.poll(() => modal().querySelector('.atlas-rc-pane')).not.toBeNull();
    const content = box(modal().querySelector('.atlas-collection-settings-content')!);
    const page = box(modal().querySelector('.atlas-collection-settings-page')!);
    expect(page.width).toBeGreaterThan(760);
    expect(box(modal().querySelector('.atlas-csm-token-stage')!).right).toBeLessThan(box(modal().querySelector('.atlas-rc-pane')!).left);
    expect(page.right).toBeLessThanOrEqual(content.right);
    // No roles of its own: the generic pair, a tab each, the card drawn for the first
    const tabs = within(modal()).getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Creature', 'NPC']);
    await expect.poll(() => modal().querySelector('.atlas-rc-stage .atlas-statblock')).not.toBeNull();
    fireEvent.click(within(modal()).getByRole('tab', { name: 'NPC' }));
    expect(within(modal()).getByRole('tab', { name: 'NPC' }).getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the Resources tab as it was without the statblock editor', async () => {
    await open('resources', false);
    expect(modal().querySelector('.atlas-csm-token-stage')).not.toBeNull();
    expect(modal().querySelector('.atlas-rc-pane')).toBeNull();
    expect(box(modal().querySelector('.atlas-collection-settings-page')!).width).toBeLessThanOrEqual(760);
  });
});
