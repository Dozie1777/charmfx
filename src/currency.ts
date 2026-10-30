/**
 * The facts about a currency that pricing needs: whether a code looks like
 * one, how many decimal places its minor unit has, and how to print it.
 */

const CODE = /^[A-Z]{3}$/;

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && CODE.test(value);
}

/** Upper-cases and checks a code, so 'eur' and 'EUR' are the same currency. */
export function normaliseCode(code: string): string {
  const upper = String(code ?? '')
    .trim()
    .toUpperCase();
  if (!CODE.test(upper)) {
    throw new RangeError(`Not a currency code: "${code}"`);
  }
  return upper;
}

const decimalsCache = new Map<string, number>();

/**
 * Decimal places in a currency's minor unit, from the runtime's Intl data:
 * 2 for EUR (cents), 0 for JPY, 3 for KWD.
 *
 * Intl follows CLDR, which matches ISO 4217 for almost every currency. Where
 * your payment provider writes a currency differently (Stripe has special
 * cases such as ISK), pass `decimals` to charmfx.
 */
export function currencyDecimals(code: string): number {
  const c = normaliseCode(code);
  let d = decimalsCache.get(c);
  if (d === undefined) {
    d =
      new Intl.NumberFormat('en', { style: 'currency', currency: c })
        .resolvedOptions().maximumFractionDigits ?? 2;
    decimalsCache.set(c, d);
  }
  return d;
}

/**
 * A major-unit amount ("14000.00", 10.99) as an integer in minor units.
 * Float noise is cleared before rounding, so 1.005 USD is 101 cents, not 100.
 */
export function toMinor(
  amount: number | string,
  code: string,
  decimals: number = currencyDecimals(code),
): number {
  const n =
    typeof amount === 'string' && amount.trim() !== ''
      ? Number(amount.trim())
      : amount;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new TypeError(`Not an amount: "${amount}"`);
  }
  return Math.round(Number((n * 10 ** decimals).toPrecision(15)));
}

/** A minor-unit integer back in major units: 1099 EUR → 10.99. */
export function fromMinor(
  minor: number,
  code: string,
  decimals: number = currencyDecimals(code),
): number {
  return minor / 10 ** decimals;
}

/**
 * The locale each currency is written in at home. Without one, Intl prints
 * the bare code for currencies the runtime's locale has no symbol for:
 * "NGN 14,000.00" under en-US, where en-NG gives "₦14,000.00".
 */
const HOME_LOCALES: Record<string, string> = {
  AUD: 'en-AU',
  CAD: 'en-CA',
  EUR: 'en-IE',
  GBP: 'en-GB',
  GHS: 'en-GH',
  INR: 'en-IN',
  KES: 'en-KE',
  NGN: 'en-NG',
  NZD: 'en-NZ',
  SGD: 'en-SG',
  UGX: 'en-UG',
  USD: 'en-US',
  ZAR: 'en-ZA',
};

export type FormatOptions = {
  /** Any BCP 47 locale. Defaults to the currency's home locale, where known. */
  locale?: string;
  /** Overrides the currency's decimal places. */
  decimals?: number;
};

/** Prints a minor-unit amount: formatMinor(1099, 'EUR') → "€10.99". */
export function formatMinor(
  minor: number,
  code: string,
  options: FormatOptions = {},
): string {
  const c = normaliseCode(code);
  const decimals = options.decimals ?? currencyDecimals(c);
  const value = Number.isFinite(minor) ? minor / 10 ** decimals : 0;

  try {
    return new Intl.NumberFormat(options.locale ?? HOME_LOCALES[c], {
      style: 'currency',
      currency: c,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    // A locale the runtime rejects shouldn't take a price off the page.
    return `${c} ${value.toFixed(decimals)}`;
  }
}
