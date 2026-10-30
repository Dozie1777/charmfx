import {
  currencyDecimals,
  formatMinor,
  normaliseCode,
  toMinor,
} from './currency';
import {
  assertEnding,
  resolveEnding,
  roundToEnding,
  type PriceEnding,
  type Rounding,
} from './rounding';

/**
 * Showing prices in a shopper's currency, and charging exactly what was
 * shown.
 *
 * Each item's price converts, gains at least the currency's minimum markup,
 * and rounds up to a clean ending, so a ₦14,000 item at €9.82 shows €10.99.
 * A checkout is the sum of those shown prices times quantities, never a
 * conversion of the cart's subtotal, so the product page, the cart and the
 * charge all agree. Shipping rounds up to the same ending without the
 * markup; a discount converts and rounds down; tax on top converts up.
 *
 * Every amount in and out is an integer in minor units (cents, kobo, yen).
 * Rates are quoted the usual way: units of `to` per one unit of `from`.
 */

export type CharmfxConfig = {
  /** How shown prices end. Default 'charm' (.99). */
  rounding?: Rounding;
  /** Per-currency rounding, e.g. { JPY: { step: 100, ending: 80 } }. */
  roundingByCurrency?: Readonly<Record<string, Rounding>>;
  /**
   * Added to each currency's rate, e.g. { GBP: 0.04 } converts at the
   * market rate plus 4%. Use it to cover card and conversion fees.
   */
  margins?: Readonly<Record<string, number>>;
  /**
   * The least an item's shown price sits above its converted amount, in the
   * shopper's minor units, before rounding. A percentage margin can't cover a
   * fixed per-payment fee (Stripe's 20p) on a small order; this does.
   */
  minMarkup?: Readonly<Record<string, number>>;
  /** Overrides a currency's decimal places, e.g. { HUF: 0 }. */
  decimals?: Readonly<Record<string, number>>;
};

export type Conversion = {
  /** The store's currency. */
  from: string;
  /** The shopper's currency. */
  to: string;
  /** The market rate: units of `to` per one unit of `from`, before margin. */
  rate: number;
};

export type QuoteLine = {
  /** The item's price in the store's minor units. */
  unitPrice: number;
  quantity: number;
};

export type QuoteInput = Conversion & {
  lines: readonly QuoteLine[];
  shipping?: number;
  discount?: number;
  /** Tax in the store's minor units, and whether the prices already hold it. */
  tax?: { amount: number; inclusive: boolean };
};

export type QuotedLine = {
  /** What the shopper sees and pays for one, in their minor units. */
  unitPrice: number;
  quantity: number;
  total: number;
};

export type QuoteTotals = {
  currency: string;
  subtotal: number;
  shipping: number;
  discount: number;
  /** Tax charged. Shown but not added to the total when inclusive. */
  tax: number;
  total: number;
};

export type Quote = QuoteTotals & {
  /** The rate used, margin included. */
  rate: number;
  lines: QuotedLine[];
  /** The same checkout in the store's currency, as the order should record it. */
  source: QuoteTotals;
};

export type Charmfx = {
  /** The market rate with `to`'s margin applied. */
  effectiveRate(rate: number, to: string): number;
  /** One item's shown price, in the shopper's minor units. */
  price(amount: number, conversion: Conversion): number;
  /** A whole checkout in the shopper's currency. */
  quote(input: QuoteInput): Quote;
  /** Decimal places in `code`'s minor unit, overrides included. */
  decimals(code: string): number;
  /** A major-unit amount ("14000.00") as minor units of `code`. */
  toMinor(amount: number | string, code: string): number;
  /** Prints minor units of `code`, in its home locale unless given one. */
  format(minor: number, code: string, locale?: string): string;
};

// Float products like 100 × 1.1 land a hair above a whole number; without
// the tolerance that hair would round a price up a minor unit.
const EPSILON = 1e-6;

/** Nothing, negatives and non-numbers count as zero. */
const clean = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

function byCode<T>(
  table: Readonly<Record<string, T>> | undefined,
  check: (value: T, code: string) => void,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const [code, value] of Object.entries(table ?? {})) {
    const c = normaliseCode(code);
    check(value, c);
    out.set(c, value);
  }
  return out;
}

function checkRounding(rounding: Rounding, where: string) {
  if (rounding === 'charm' || rounding === 'whole' || rounding === 'none') return;
  if (typeof rounding !== 'object' || rounding === null) {
    throw new RangeError(`${where}: unknown rounding "${String(rounding)}"`);
  }
  assertEnding(rounding);
}

export function charmfx(config: CharmfxConfig = {}): Charmfx {
  const rounding = config.rounding ?? 'charm';
  checkRounding(rounding, 'rounding');

  const roundings = byCode(config.roundingByCurrency, (r, c) =>
    checkRounding(r, `roundingByCurrency.${c}`),
  );
  const margins = byCode(config.margins, (m, c) => {
    if (!Number.isFinite(m) || m <= -1) {
      throw new RangeError(`margins.${c} must be a number above -1, got ${m}`);
    }
  });
  const markups = byCode(config.minMarkup, (m, c) => {
    if (!Number.isInteger(m) || m < 0) {
      throw new RangeError(`minMarkup.${c} must be a whole number of 0 or more, got ${m}`);
    }
  });
  const decimalOverrides = byCode(config.decimals, (d, c) => {
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      throw new RangeError(`decimals.${c} must be a whole number from 0 to 6, got ${d}`);
    }
  });

  const decimals = (code: string) => {
    const c = normaliseCode(code);
    return decimalOverrides.get(c) ?? currencyDecimals(c);
  };

  const effectiveRate = (rate: number, to: string) => {
    if (!(typeof rate === 'number' && Number.isFinite(rate) && rate > 0)) {
      throw new RangeError(`No usable rate into ${to}: ${rate}`);
    }
    return rate * (1 + (margins.get(normaliseCode(to)) ?? 0));
  };

  /** Everything a conversion needs, worked out once per call. */
  function prepare({ from, to, rate }: Conversion) {
    const f = normaliseCode(from);
    const t = normaliseCode(to);
    if (f === t) return null;

    const r = effectiveRate(rate, t);
    const toDecimals = decimals(t);
    // Rates are major to major; the scale moves between the two minor units.
    const factor = r * 10 ** (toDecimals - decimals(f));

    const up = (amount: number) => {
      const minor = clean(amount) * factor;
      return minor > 0 && Number.isFinite(minor) ? Math.ceil(minor - EPSILON) : 0;
    };
    const down = (amount: number) => {
      const minor = clean(amount) * factor;
      return minor > 0 && Number.isFinite(minor) ? Math.floor(minor + EPSILON) : 0;
    };
    const ending: PriceEnding = resolveEnding(roundings.get(t) ?? rounding, toDecimals);
    const markup = markups.get(t) ?? 0;

    return {
      to: t,
      rate: r,
      up,
      down,
      ending,
      price: (amount: number) => roundToEnding(up(amount), ending, markup),
    };
  }

  function price(amount: number, conversion: Conversion): number {
    const c = prepare(conversion);
    return c ? c.price(amount) : clean(amount);
  }

  function totals(
    currency: string,
    lines: QuotedLine[],
    shipping: number,
    discount: number,
    tax: number,
    taxOnTop: boolean,
  ): QuoteTotals {
    const subtotal = lines.reduce((sum, l) => sum + l.total, 0);
    const cappedDiscount = Math.min(discount, subtotal + shipping);
    return {
      currency,
      subtotal,
      shipping,
      discount: cappedDiscount,
      tax,
      total: subtotal + shipping - cappedDiscount + (taxOnTop ? tax : 0),
    };
  }

  function quote(input: QuoteInput): Quote {
    const lines = input.lines ?? [];
    for (const l of lines) {
      if (!Number.isFinite(l.quantity) || l.quantity < 0) {
        throw new RangeError(`A line's quantity must be 0 or more, got ${l.quantity}`);
      }
    }
    const taxOnTop = Boolean(input.tax && !input.tax.inclusive);
    const taxAmount = input.tax?.amount ?? 0;

    const sourceLines = lines.map((l) => {
      const unitPrice = clean(l.unitPrice);
      return { unitPrice, quantity: l.quantity, total: unitPrice * l.quantity };
    });
    const source = totals(
      normaliseCode(input.from),
      sourceLines,
      clean(input.shipping),
      clean(input.discount),
      clean(taxAmount),
      taxOnTop,
    );

    const c = prepare(input);
    if (!c) return { ...source, rate: 1, lines: sourceLines, source };

    const shownLines = lines.map((l) => {
      const unitPrice = c.price(l.unitPrice);
      return { unitPrice, quantity: l.quantity, total: unitPrice * l.quantity };
    });
    const shown = totals(
      c.to,
      shownLines,
      roundToEnding(c.up(input.shipping ?? 0), c.ending),
      c.down(input.discount ?? 0),
      c.up(taxAmount),
      taxOnTop,
    );

    return { ...shown, rate: c.rate, lines: shownLines, source };
  }

  return {
    effectiveRate,
    price,
    quote,
    decimals,
    toMinor: (amount, code) => toMinor(amount, code, decimals(code)),
    format: (minor, code, locale) =>
      formatMinor(minor, code, { locale, decimals: decimals(code) }),
  };
}
