/**
 * What a statblock's `@` references read (`references.ts`): a field by its key or a key it had
 * before a rename (the note's value under either), a dotted index into it (`stats.0`, `saves.dex`), a Table's slot by its name or
 * key in any Table field (`@str`, `@strength`, `@stats.str`) with a worked-out row of the Table
 * after it (`@str.mod`, `@str.save`: the row's own entry for the slot, else its formula over the
 * score), else what the statblock's meanings and loose key matching find (`@hp`). Only a single
 * value is read: a list or a record is no number. Pure.
 */

import { normalizedKey, resolveField } from '../../resources/resourceFields';
import { evaluateFormula } from '../expressions/evaluate';
import { isExpressionError } from '../expressions/errors';
import { parseFormula } from '../expressions/parse';
import { meaningsOf, withFormerKeysAliased } from '../resolve/fieldMeanings';
import { headerParts } from '../model/templateHeader';
import type { FieldKey, FieldValue, ScoreColumn, StatblockTemplate, TemplateField } from '../model/templateTypes';
import { flattenReadingOrder } from '../model/treeQueries';
import { readerFor, scoreIn, slotKeyOf, type FieldRecord, type ValueReader } from './fieldValues';
import { pairValue } from './pairValues';
import { fillReferences, numberValue } from './fillReferences';
import { namesReference, type FieldLookup } from './references';

/** One slot of a Table field, and the worked-out rows of the Table that draws it. */
interface Slot {
  readonly field: TemplateField;
  readonly index: number;
  readonly columns: readonly ScoreColumn[];
}

/** How many references deep one value may name others. */
const MAX_CHAIN = 4;
/** How many values that name references one lookup works out at most. */
const MAX_EXPANSIONS = 256;
const NOTHING_READ: ReadonlySet<string> = new Set();

const isSingle = (value: unknown): value is string | number | boolean => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/** The worked-out rows of the first Table block drawing each Table field. */
function tableColumns(template: StatblockTemplate): Map<FieldKey, readonly ScoreColumn[]> {
  const columns = new Map<FieldKey, readonly ScoreColumn[]>();
  const blocks = [...headerParts(template).map((part) => part.block), ...flattenReadingOrder(template.layout.blocks)];
  for (const block of blocks) {
    if (block.type === 'scores' && !columns.has(block.field)) columns.set(block.field, block.columns ?? []);
  }
  return columns;
}

/** Every slot of every Table field by its name and key, without case or separators; the first Table to name one keeps it. */
function slotsByName(fields: readonly TemplateField[], columns: ReadonlyMap<FieldKey, readonly ScoreColumn[]>): Map<string, Slot> {
  const slots = new Map<string, Slot>();
  for (const field of fields) {
    if (field.type !== 'scores') continue;
    (field.slots ?? []).forEach((name, index) => {
      const slot = { field, index, columns: columns.get(field.key) ?? [] };
      for (const each of [name, slotKeyOf(field, index)]) {
        const key = each === undefined ? '' : normalizedKey(each);
        if (key !== '' && !slots.has(key)) slots.set(key, slot);
      }
    });
  }
  return slots;
}

/** A worked-out row's value for a slot: the row's entry in its pairs field, else its formula over the score. */
function columnValue(column: ScoreColumn, slot: Slot, score: FieldValue | undefined, reader: ValueReader): FieldValue | undefined {
  if (column.field) {
    const entry = pairValue(reader(column.field), slotKeyOf(slot.field, slot.index), slot.field.slots?.[slot.index]);
    if (entry !== undefined && entry !== null && entry !== '') return entry;
  }
  if (!column.formula?.trim() || score === undefined) return undefined;
  const node = parseFormula(column.formula);
  if (isExpressionError(node)) return undefined;
  const result = evaluateFormula(node, reader, { value: score });
  return result.ok ? result.value : undefined;
}

/** The statblock's value at a reference's path, as `references.ts` asks for it. */
export function statblockLookup(template: StatblockTemplate, record: FieldRecord, fields: readonly TemplateField[] = template.fields): FieldLookup {
  const reader = readerFor(record, fields);
  const scoreFields = new Set(fields.filter((field) => field.type === 'scores').map((field) => field.key));
  let slots: Map<string, Slot> | null = null;
  let loose: { record: FieldRecord; meanings: ReturnType<typeof meaningsOf> } | null = null;

  const slotValue = (path: string): FieldValue | undefined => {
    const parts = path.split('.');
    // `stats.str.mod` names the field first
    const named = parts.length > 1 && scoreFields.has(parts[0]!) ? parts.slice(1) : parts;
    const [name, row, ...rest] = named;
    if (name === undefined || rest.length > 0) return undefined;
    slots ??= slotsByName(fields, tableColumns(template));
    const slot = slots.get(normalizedKey(name));
    if (!slot) return undefined;
    const score = scoreIn(reader(slot.field.key), slot.field, slot.index);
    if (row === undefined) return score;
    const column = slot.columns.find((each) => each.label !== undefined && normalizedKey(each.label) === normalizedKey(row));
    return column ? columnValue(column, slot, score, reader) : undefined;
  };

  // A reference written before its field was renamed reads the field under its new key
  const renamed = new Map(fields.flatMap((field) => (field.formerKeys ?? []).map((former): [string, FieldKey] => [former, field.key])));
  const current = (path: string): string => {
    const [first, ...rest] = path.split('.');
    const key = first === undefined ? undefined : renamed.get(first);
    return key === undefined ? path : [key, ...rest].join('.');
  };

  const read = (written: string): string | number | boolean | undefined => {
    const path = current(written);
    const direct = reader(path);
    if (isSingle(direct)) return direct;
    const slot = slotValue(path);
    if (isSingle(slot)) return slot;
    loose ??= { record: withFormerKeysAliased(record, fields), meanings: meaningsOf(fields) };
    const found = resolveField(loose.record, path, loose.meanings);
    return isSingle(found) ? found : undefined;
  };

  // A value that names references itself (`ac: 10 + @dex.mod`) reads as what it comes to, a few steps
  // deep and never in a circle. Each path is worked out once per lookup and the work is capped, so
  // a note whose values name each other many times over (one a player wrote online) costs little.
  const worked = new Map<string, unknown>();
  let budget = MAX_EXPANSIONS;
  const chained = (path: string, reading: ReadonlySet<string>): unknown => {
    if (worked.has(path)) return worked.get(path);
    const value = read(path);
    if (typeof value !== 'string' || !namesReference(value)) return value;
    if (reading.size >= MAX_CHAIN || reading.has(path) || budget <= 0) return value;
    budget -= 1;
    const inner = new Set(reading).add(path);
    const result = numberValue(fillReferences(value, (next) => chained(next, inner)).text);
    worked.set(path, result);
    return result;
  };
  return (path) => chained(path, NOTHING_READ);
}
