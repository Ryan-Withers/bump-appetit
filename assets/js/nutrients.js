// The pregnancy nutrients, in one place.
//
// The verdict sheet renders chips from this list and the Search screen offers
// the same seven as browse chips, so the two can never drift apart. Display
// labels live here rather than in strings.js on purpose: check-strings walks
// literal str() paths, and a lookup built from a loop is invisible to it.
//
// The order is fixed and deliberate: folate and iron lead because they are the
// two every midwife raises first.

export const NUTRIENTS = Object.freeze([
  Object.freeze({ key: 'folate', label: 'Folate' }),
  Object.freeze({ key: 'iron', label: 'Iron' }),
  Object.freeze({ key: 'calcium', label: 'Calcium' }),
  Object.freeze({ key: 'protein', label: 'Protein' }),
  Object.freeze({ key: 'omega3', label: 'Omega-3' }),
  Object.freeze({ key: 'iodine', label: 'Iodine' }),
  Object.freeze({ key: 'fibre', label: 'Fibre' }),
]);

/** The words the chips and the browse list say out loud. */
export const NUTRIENT_LEVELS = Object.freeze({ high: 'high', med: 'medium', low: 'low' });

/**
 * The levels a browse list will show, worst-first order not applicable here:
 * high leads because it is the better answer to "where do I get this".
 *
 * `low` is deliberately absent, and this is the one rule in the file that
 * matters. A low chip is a myth-buster, not a source: spinach is marked low on
 * iron precisely because everyone believes otherwise. Putting it in the iron
 * list would tell her the exact lie the chip exists to correct.
 */
export const BROWSABLE_LEVELS = Object.freeze(['high', 'med']);

export function nutrientLabel(key) {
  const found = NUTRIENTS.find((entry) => entry.key === key);
  return found ? found.label : String(key || '');
}
