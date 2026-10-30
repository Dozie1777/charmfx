import { describe, expect, it } from 'vitest';
import { crossRates } from '../src';
import { parseExchangeRateApi } from '../src/providers/exchangerate-api';

describe('crossRates', () => {
  const usd = { NGN: 1600, GBP: 0.8, EUR: 0.9 };

  it('crosses through the base: NGN to GBP', () => {
    const rates = crossRates(usd, 'USD', 'NGN', ['GBP', 'EUR']);
    expect(rates.GBP).toBeCloseTo(0.8 / 1600, 12);
    expect(rates.EUR).toBeCloseTo(0.9 / 1600, 12);
  });

  it('handles the base itself on either side', () => {
    expect(crossRates(usd, 'USD', 'USD', ['NGN']).NGN).toBe(1600);
    expect(crossRates(usd, 'USD', 'NGN', ['USD']).USD).toBeCloseTo(1 / 1600, 12);
  });

  it('leaves out a currency with no rate rather than guessing', () => {
    expect(crossRates(usd, 'USD', 'NGN', ['GBP', 'JPY'])).toEqual({ GBP: 0.8 / 1600 });
  });

  it('returns nothing when the store currency has no rate', () => {
    expect(crossRates(usd, 'USD', 'GHS', ['GBP'])).toEqual({});
  });
});

describe('parseExchangeRateApi', () => {
  it('reads the base, the rates and when they were published', () => {
    const parsed = parseExchangeRateApi({
      result: 'success',
      base_code: 'USD',
      time_last_update_unix: 1_790_000_000,
      conversion_rates: { USD: 1, NGN: 1600, GBP: 0.79 },
    });

    expect(parsed.base).toBe('USD');
    expect(parsed.rates).toEqual({ USD: 1, NGN: 1600, GBP: 0.79 });
    expect(parsed.publishedAt?.getTime()).toBe(1_790_000_000 * 1000);
  });

  it('drops malformed codes and non-positive rates', () => {
    const parsed = parseExchangeRateApi({
      result: 'success',
      base_code: 'USD',
      conversion_rates: { USD: 1, NGN: 1600, gbp: 0.79, XXX: 0, EUR: 'x' },
    });
    expect(parsed.rates).toEqual({ USD: 1, NGN: 1600 });
  });

  it('throws on an error response instead of returning nothing', () => {
    expect(() =>
      parseExchangeRateApi({ result: 'error', 'error-type': 'invalid-key' }),
    ).toThrow('invalid-key');
  });

  it('throws when there are no usable rates', () => {
    expect(() =>
      parseExchangeRateApi({ result: 'success', base_code: 'USD', conversion_rates: {} }),
    ).toThrow('no usable rates');
  });
});
