import type { BookResourceMessage } from '../../protocol/index.ts';
import type { PlacedTokenSource } from '../../../characters/playerCharacters';
import type { ResourceDefinition, ResourceHolder, ResourceValue } from '../../../resources/resourceTypes';
import { visibleResources } from '../../../resources/visibleResources';
import type { BookScene } from './bookScene.ts';
import type { PlayedCharacter } from './characters.ts';

/**
 * A player's edit of their own character's resource, checked: written to the token in the shared
 * scene (`token`), or, while that scene holds no token of the character, to the values the played
 * campaign keeps of it (`character`). `current` is as the player sent it; the writer clamps it to
 * the value it writes over. A number the character's statblock tracks carries the value its sheet
 * offered (`tracked`): its maximum is the note's, and where nothing holds it yet it starts there.
 */
export type ResourceEdit =
  | { readonly kind: 'token'; readonly from: string; readonly tokenId: string; readonly key: string; readonly current: number; readonly tracked?: ResourceValue }
  | { readonly kind: 'character'; readonly from: string; readonly placed: PlacedTokenSource; readonly key: string; readonly current: number; readonly tracked?: ResourceValue };

/**
 * The value a player may change of their own character's resource: one its token holds
 * (`visibleResources` for the viewer `owner`) that is no fixed value, or a tracked number (`tracked`:
 * as its sheet offered it), with what the token holds of it. Null for any other key.
 */
export function editableValue(token: ResourceHolder, definitions: readonly ResourceDefinition[], key: string, tracked?: ResourceValue): ResourceValue | null {
  if (tracked) return { current: token.resources?.[key]?.current ?? tracked.current, max: tracked.max };
  const shown = visibleResources(token, definitions, 'owner').find(({ definition }) => definition.key === key);
  return shown === undefined || shown.definition.direction === 'static' ? null : shown.value;
}

/**
 * Whether a player may make an edit, and where it goes; null when it is refused. The player must
 * play a character whose last sheet offers the resource for editing. While the shared scene holds
 * the character's token, that token must still be theirs and the resource one they may change
 * there; otherwise the edit is for the character's values.
 */
export function checkResourceEdit(
  from: string, character: PlayedCharacter | null, scene: BookScene | null, ownerOf: (tokenId: string) => string | undefined, message: BookResourceMessage,
): ResourceEdit | null {
  const offered = character?.sheet.resources.find((resource) => resource.key === message.key && resource.editable);
  if (character === null || offered === undefined) return null;
  const { key, current } = message;
  const token = scene === null ? undefined : scene.tokens[character.tokenId];
  // No resource of the collection: a number the statblock tracks
  const definitions = scene?.resources ?? character.drawnWith.definitions;
  const tracked = definitions.some((definition) => definition.key === key) ? undefined : { current: offered.current, max: offered.max };
  if (scene === null || token === undefined) return { kind: 'character', from, placed: character.placed, key, current, ...(tracked && { tracked }) };
  if (ownerOf(character.tokenId) !== from || (!tracked && editableValue(token, scene.resources, key) === null)) return null;
  return { kind: 'token', from, tokenId: character.tokenId, key, current, ...(tracked && { tracked }) };
}
