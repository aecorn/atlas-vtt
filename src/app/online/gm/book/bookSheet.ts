import { isResourceKey, MAX_BOOK_TITLE, MAX_SHEET_RESOURCES, MAX_TOKEN_VALUE, parseBookCharacter, type AssetRef, type BookCharacter, type SheetResource } from '../../protocol/index.ts';
import type { ResourceDefinition, ResourceHolder } from '../../../resources/resourceTypes';
import { visibleResources } from '../../../resources/visibleResources';
import type { ShownRollToken } from '../../../services/playerRollSource';
import { hexColour, ringColour } from '../scenePicture.ts';
import { clippedLine } from './bookTexts.ts';
import type { TrackedSheetValue } from './trackedSheet.ts';

const DIRECTIONS: readonly string[] = ['drains', 'fills', 'static'];

const isValue = (value: number): boolean => Number.isFinite(value) && Math.abs(value) <= MAX_TOKEN_VALUE;

/**
 * The resources on a character's sheet: every one its token holds (`visibleResources` for the
 * viewer `owner`), bars and wheels alike, by name, then the numbers its statblock tracks. Hiding a
 * resource from players hides it on other tokens, never from the player whose character it is.
 * Each names its key, and the player may change every one but a fixed value (`static`), which the
 * statblock gives, and a tracked number whose field the template lets them only read.
 */
function sheetResources(token: ResourceHolder, definitions: readonly ResourceDefinition[], tracked: readonly TrackedSheetValue[]): SheetResource[] {
  const own = visibleResources(token, definitions, 'owner').map((shown) => ({ ...shown, editable: true }));
  return [...own, ...tracked].flatMap(({ definition, value, editable }): SheetResource[] => {
    const name = clippedLine(definition.name, MAX_BOOK_TITLE);
    const colour = hexColour(definition.color);
    if (name === null || colour === null || !DIRECTIONS.includes(definition.direction) || !isValue(value.current) || !isValue(value.max)) return [];
    const key = isResourceKey(definition.key) ? definition.key : null;
    return [{ key, name, colour, direction: definition.direction, current: value.current, max: value.max, editable: editable && key !== null && definition.direction !== 'static' }];
  }).slice(0, MAX_SHEET_RESOURCES);
}

/**
 * The sheet of a player's own character, from its token as the players' frame shows it: its name
 * (always: the nameplate setting hides other tokens' names, not one's own), artwork by hash, the
 * ring's colour (none for artwork shown unframed), its resources and its statblock's tracked
 * numbers (`trackedSheetValues`). Null when it cannot be told.
 */
export function sheetOf(
  shown: ShownRollToken, token: ResourceHolder, definitions: readonly ResourceDefinition[], art: (path: string) => AssetRef | null, tracked: readonly TrackedSheetValue[] = [],
): BookCharacter | null {
  return parseBookCharacter({
    name: clippedLine(shown.name, MAX_BOOK_TITLE) ?? '',
    art: shown.imagePath === undefined ? null : art(shown.imagePath),
    ring: shown.showRing ? ringColour(shown.ringColor) : null,
    resources: sheetResources(token, definitions, tracked),
  }) ?? null;
}
