import { isCurrencyCode } from '../currency';

/** Rates as a provider quotes them: units of each currency per one `base`. */
export type QuotedRates = {
  base: string;
  rates: Record<string, number>;
  publishedAt: Date | null;
};

/**
 * Parses ExchangeRate-API's `/latest/{base}` response.
 * https://www.exchangerate-api.com/docs/standard-requests
 *
 * Throws on an error response or a malformed body rather than returning an
 * empty set: keep the rates you already have. A refresh that "succeeded"
 * with nothing would take every shopper currency off the storefront.
 */
export function parseExchangeRateApi(body: unknown): QuotedRates {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.result !== 'success') {
    const reason =
      typeof b['error-type'] === 'string' ? b['error-type'] : 'unknown';
    throw new Error(`ExchangeRate-API returned an error: ${reason}`);
  }
  if (!isCurrencyCode(b.base_code)) {
    throw new Error('ExchangeRate-API response has no base_code');
  }

  const raw = (b.conversion_rates ?? {}) as Record<string, unknown>;
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(raw)) {
    if (isCurrencyCode(code) && typeof value === 'number' && value > 0) {
      rates[code] = value;
    }
  }
  if (Object.keys(rates).length === 0) {
    throw new Error('ExchangeRate-API response has no usable rates');
  }

  const unix =
    typeof b.time_last_update_unix === 'number' ? b.time_last_update_unix : null;

  return {
    base: b.base_code,
    rates,
    publishedAt: unix ? new Date(unix * 1000) : null,
  };
}
