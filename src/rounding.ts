/**
 * Where a shown price lands: the next amount, at or above the converted one,
 * whose remainder after dividing by `step` is `ending`. Both in minor units
 * of the shopper's currency.
 *
 *   { step: 100, ending: 99 }   → 10.99, 11.99, 12.99 …
 *   { step: 100, ending: 95 }   → 10.95, 11.95 …
 *   { step: 100, ending: 80 }   → ¥1,980, ¥2,080 … (JPY has no decimals)
 *   { step: 50000, ending: 0 }  → ₦500, ₦1,000, ₦1,500 …
 */
export type PriceEnding = { step: number; ending: number };

/**
 * - 'charm': ends in .99 (3-decimal currencies .990); whole units for
 *   currencies with no decimals. The default.
 * - 'whole': rounds up to a whole unit, 10.00, 11.00 …
 * - 'none':  rounds up to the minor unit only.
 * - a PriceEnding for anything else.
 */
export type Rounding = 'charm' | 'whole' | 'none' | PriceEnding;

export function assertEnding(rule: PriceEnding): void {
  const { step, ending } = rule ?? ({} as PriceEnding);
  if (!Number.isInteger(step) || step < 1) {
    throw new RangeError(`A price ending's step must be a whole number of 1 or more, got ${step}`);
  }
  if (!Number.isInteger(ending) || ending < 0 || ending >= step) {
    throw new RangeError(
      `A price ending must be a whole number from 0 to ${step - 1}, got ${ending}`,
    );
  }
}

/** The ending a rounding rule means for a currency with `decimals` places. */
export function resolveEnding(rounding: Rounding, decimals: number): PriceEnding {
  const unit = 10 ** decimals;
  if (rounding === 'none') return { step: 1, ending: 0 };
  if (rounding === 'whole') return { step: unit, ending: 0 };
  if (rounding === 'charm') {
    if (decimals === 0) return { step: 1, ending: 0 };
    if (decimals === 1) return { step: 10, ending: 9 };
    return { step: unit, ending: 99 * 10 ** (decimals - 2) };
  }
  assertEnding(rounding);
  return rounding;
}

/**
 * The next price on `rule` that's at least `minMarkup` above `minor`.
 * With { step: 100, ending: 99 } and a markup of 35:
 * 982 → 1099, 1050 → 1099, 1070 → 1199. Nothing stays nothing.
 */
export function roundToEnding(
  minor: number,
  rule: PriceEnding,
  minMarkup = 0,
): number {
  if (!(minor > 0)) return 0;
  const { step, ending } = rule;
  const floor = minor + minMarkup;
  return Math.max(ending, Math.ceil((floor - ending) / step) * step + ending);
}
