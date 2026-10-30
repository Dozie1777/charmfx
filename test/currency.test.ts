import { describe, expect, it } from 'vitest';
import { charmfx, currencyDecimals, formatMinor, fromMinor, toMinor } from '../src';

describe('currencyDecimals', () => {
  it('reads decimal places from Intl', () => {
    expect(currencyDecimals('EUR')).toBe(2);
    expect(currencyDecimals('jpy')).toBe(0);
    expect(currencyDecimals('KWD')).toBe(3);
  });

  it('refuses something that is not a code', () => {
    expect(() => currencyDecimals('naira')).toThrow(RangeError);
  });
});

describe('toMinor / fromMinor', () => {
  it('reads decimal strings and numbers', () => {
    expect(toMinor('14000.00', 'NGN')).toBe(1_400_000);
    expect(toMinor(10.99, 'EUR')).toBe(1099);
    expect(toMinor(1580, 'JPY')).toBe(1580);
    expect(toMinor('3.99', 'KWD')).toBe(3990);
  });

  it('clears float noise before rounding', () => {
    expect(toMinor(1.005, 'USD')).toBe(101);
    expect(toMinor(0.1 + 0.2, 'USD')).toBe(30);
  });

  it('refuses things that are not amounts', () => {
    expect(() => toMinor('', 'USD')).toThrow(TypeError);
    expect(() => toMinor('abc', 'USD')).toThrow(TypeError);
    expect(() => toMinor(Number.POSITIVE_INFINITY, 'USD')).toThrow(TypeError);
  });

  it('goes back to major units', () => {
    expect(fromMinor(1099, 'EUR')).toBe(10.99);
    expect(fromMinor(1580, 'JPY')).toBe(1580);
  });
});

describe('formatMinor', () => {
  it('prints each currency the way it is written at home', () => {
    // Under en-US, Intl prints this "NGN 14,000.00".
    expect(formatMinor(1_400_000, 'NGN')).toBe('₦14,000.00');
    expect(formatMinor(1099, 'EUR')).toBe('€10.99');
    expect(formatMinor(10099, 'GBP')).toBe('£100.99');
  });

  it('takes a locale', () => {
    expect(formatMinor(1580, 'JPY', { locale: 'en-US' })).toBe('¥1,580');
    expect(formatMinor(1099, 'EUR', { locale: 'de-DE' })).toBe('10,99 €');
  });

  it('falls back to the code when the locale is rejected', () => {
    expect(formatMinor(1099, 'EUR', { locale: 'not a locale!' })).toBe('EUR 10.99');
  });

  it('uses decimals overrides through charmfx', () => {
    const huf = charmfx({ decimals: { HUF: 0 } });
    expect(huf.format(4990, 'HUF', 'en-US')).toBe('HUF 4,990');
  });
});
