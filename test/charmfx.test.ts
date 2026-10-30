import { describe, expect, it } from 'vitest';
import { charmfx } from '../src';

// The minimum markups SalesCenta's checkout charged with when this was
// extracted, so these cases match its tests number for number.
const p = charmfx({
  minMarkup: { GBP: 30, EUR: 35, USD: 40, CAD: 55 },
});

// NGN→GBP on 2026-10-05, before the margin.
const NGN_TO_GBP = 0.7557 / 1331.2792;
// Puts ₦14,000 at €9.82: the test order that lost money on a US card.
const NGN_TO_EUR = 0.000701;

const eur = { from: 'NGN', to: 'EUR', rate: NGN_TO_EUR };
const usd = { from: 'NGN', to: 'USD', rate: 0.001 };

describe('price', () => {
  it('converts, adds the minimum markup and ends in .99', () => {
    expect(p.price(1_400_000, eur)).toBe(1099); // €9.82 → €10.99
  });

  it("applies the currency's margin to the rate", () => {
    const withMargin = charmfx({
      margins: { GBP: 0.04 },
      minMarkup: { GBP: 30 },
    });
    // ₦170,000 at the market rate +4% is £100.3604…, +30p, so £100.99.
    expect(withMargin.price(17_000_000, { from: 'NGN', to: 'GBP', rate: NGN_TO_GBP })).toBe(10099);
    expect(withMargin.effectiveRate(NGN_TO_GBP, 'gbp')).toBeCloseTo(NGN_TO_GBP * 1.04, 15);
  });

  it("doesn't round an exact amount up on float noise", () => {
    const plain = charmfx({ rounding: 'none' });
    // 100 × 1.1 is 110.00000000000001 in floating point.
    expect(plain.price(100, { from: 'USD', to: 'EUR', rate: 1.1 })).toBe(110);
    expect(plain.price(10_000, { from: 'USD', to: 'EUR', rate: 0.5 })).toBe(5000);
  });

  it('treats nothing and negatives as zero', () => {
    expect(p.price(0, eur)).toBe(0);
    expect(p.price(-500, eur)).toBe(0);
    expect(p.price(Number.NaN, eur)).toBe(0);
  });

  it('leaves an amount alone when the currencies are the same', () => {
    expect(p.price(1_400_000, { from: 'NGN', to: 'ngn', rate: 1 })).toBe(1_400_000);
  });

  it('refuses a missing, zero or negative rate', () => {
    expect(() => p.price(100, { ...eur, rate: 0 })).toThrow(RangeError);
    expect(() => p.price(100, { ...eur, rate: Number.NaN })).toThrow(RangeError);
    expect(() => p.price(100, { ...eur, rate: -1 })).toThrow(RangeError);
  });

  it('refuses something that is not a currency code', () => {
    expect(() => p.price(100, { ...eur, to: 'euro' })).toThrow(RangeError);
  });
});

describe('decimal places', () => {
  it('ends JPY prices on whole yen by default', () => {
    // $10.00 at 151.234 is ¥1,512.34, so ¥1,513.
    expect(p.price(1000, { from: 'USD', to: 'JPY', rate: 151.234 })).toBe(1513);
  });

  it('takes a custom ending per currency', () => {
    const yen = charmfx({
      roundingByCurrency: { JPY: { step: 100, ending: 80 } },
    });
    expect(yen.price(1000, { from: 'USD', to: 'JPY', rate: 151.234 })).toBe(1580);
  });

  it('ends three-decimal currencies in .990', () => {
    // $10.00 at 0.307 is KWD 3.070, so KWD 3.990.
    expect(p.price(1000, { from: 'USD', to: 'KWD', rate: 0.307 })).toBe(3990);
  });

  it('converts from a zero-decimal currency', () => {
    // ¥1,500 at 0.0066 is $9.90, so $9.99.
    const plain = charmfx();
    expect(plain.price(1500, { from: 'JPY', to: 'USD', rate: 0.0066 })).toBe(999);
  });

  it('honours a decimals override', () => {
    const huf = charmfx({ decimals: { HUF: 0 } });
    expect(huf.decimals('HUF')).toBe(0);
    expect(huf.toMinor('4990', 'HUF')).toBe(4990);
  });
});

describe('rounding modes', () => {
  const amount = 1_400_000; // €9.814
  it('whole rounds up to the next whole unit', () => {
    const whole = charmfx({ rounding: 'whole' });
    expect(whole.price(amount, eur)).toBe(1000);
  });

  it('none rounds up to the minor unit only', () => {
    const none = charmfx({ rounding: 'none' });
    expect(none.price(amount, eur)).toBe(982);
  });

  it('a custom ending applies to every currency', () => {
    const ninetyFive = charmfx({ rounding: { step: 100, ending: 95 } });
    expect(ninetyFive.price(amount, eur)).toBe(995);
  });
});

describe('quote', () => {
  it('charges what the product showed: €9.82 becomes €10.99', () => {
    const quote = p.quote({ ...eur, lines: [{ unitPrice: 1_400_000, quantity: 1 }] });
    expect(quote.subtotal).toBe(1099);
    expect(quote.total).toBe(1099);
    expect(quote.currency).toBe('EUR');
    expect(quote.source.total).toBe(1_400_000);
    expect(quote.source.currency).toBe('NGN');
  });

  it("adds up each line's shown price, and shipping ends in .99", () => {
    const quote = p.quote({
      ...eur,
      lines: [
        { unitPrice: 1_400_000, quantity: 2 }, // €10.99 each
        { unitPrice: 500_000, quantity: 1 }, // €3.51 → €3.99
      ],
      shipping: 300_000, // €2.11 → €2.99, no markup
    });
    expect(quote.lines).toEqual([
      { unitPrice: 1099, quantity: 2, total: 2198 },
      { unitPrice: 399, quantity: 1, total: 399 },
    ]);
    expect(quote.subtotal).toBe(1099 * 2 + 399);
    expect(quote.shipping).toBe(299);
    expect(quote.total).toBe(1099 * 2 + 399 + 299);
    expect(quote.source.total).toBe(3_300_000 + 300_000);
  });

  it('takes a discount off, rounded down', () => {
    const quote = p.quote({
      ...usd,
      lines: [{ unitPrice: 1_000_000, quantity: 1 }],
      discount: 100_000,
    });
    expect(quote.subtotal).toBe(1099); // $10.00 + 40c → $10.99
    expect(quote.discount).toBe(100);
    expect(quote.total).toBe(999);
  });

  it('never discounts below zero', () => {
    const quote = p.quote({
      ...usd,
      lines: [{ unitPrice: 1_000_000, quantity: 1 }],
      discount: 5_000_000,
    });
    expect(quote.discount).toBe(1099);
    expect(quote.total).toBe(0);
    expect(quote.source.total).toBe(0);
  });

  it("doesn't add tax that's inside the prices", () => {
    const quote = p.quote({
      ...usd,
      lines: [{ unitPrice: 1_000_000, quantity: 1 }],
      shipping: 200_000,
      tax: { amount: 100_000, inclusive: true },
    });
    expect(quote.tax).toBe(100); // shown, not added
    expect(quote.total).toBe(1099 + 299);
    expect(quote.source.total).toBe(1_200_000);
  });

  it('adds tax charged on top of the prices', () => {
    const quote = p.quote({
      ...usd,
      lines: [{ unitPrice: 1_000_000, quantity: 1 }],
      shipping: 200_000,
      tax: { amount: 100_000, inclusive: false },
    });
    expect(quote.total).toBe(1099 + 299 + 100);
    expect(quote.source.total).toBe(1_300_000);
  });

  it('reports the rate it used, margin included', () => {
    const withMargin = charmfx({ margins: { USD: 0.05 } });
    const quote = withMargin.quote({ ...usd, lines: [] });
    expect(quote.rate).toBeCloseTo(0.00105, 15);
    expect(quote.total).toBe(0);
  });

  it('passes the checkout through when the currencies are the same', () => {
    const quote = p.quote({
      from: 'NGN',
      to: 'NGN',
      rate: 1,
      lines: [{ unitPrice: 1_400_000, quantity: 2 }],
      shipping: 300_000,
    });
    expect(quote.total).toBe(3_100_000);
    expect(quote.rate).toBe(1);
    expect(quote.lines[0]?.unitPrice).toBe(1_400_000);
  });

  it('refuses a bad rate or quantity', () => {
    const lines = [{ unitPrice: 100, quantity: 1 }];
    expect(() => p.quote({ ...eur, rate: 0, lines })).toThrow(RangeError);
    expect(() =>
      p.quote({ ...eur, lines: [{ unitPrice: 100, quantity: Number.NaN }] }),
    ).toThrow(RangeError);
  });
});

describe('config', () => {
  it('refuses endings that could never land', () => {
    expect(() => charmfx({ rounding: { step: 0, ending: 0 } })).toThrow(RangeError);
    expect(() => charmfx({ rounding: { step: 100, ending: 100 } })).toThrow(RangeError);
    expect(() =>
      charmfx({ roundingByCurrency: { JPY: { step: 10, ending: -1 } } }),
    ).toThrow(RangeError);
  });

  it('refuses unusable margins, markups and decimals', () => {
    expect(() => charmfx({ margins: { GBP: Number.NaN } })).toThrow(RangeError);
    expect(() => charmfx({ minMarkup: { GBP: 2.5 } })).toThrow(RangeError);
    expect(() => charmfx({ decimals: { HUF: 9 } })).toThrow(RangeError);
    expect(() => charmfx({ margins: { pounds: 0.04 } })).toThrow(RangeError);
  });

  it('reads lower-case currency keys', () => {
    const lower = charmfx({ minMarkup: { eur: 35 } });
    expect(lower.price(1_400_000, eur)).toBe(1099);
  });
});
