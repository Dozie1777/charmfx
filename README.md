# charmfx

**What you see is what you charge.** Prices in a shopper's currency with clean endings like €10.99, charged exactly as shown.

```
npm install @dozie_melvin96/charmfx
```

No dependencies. Runs anywhere with `Intl`: Node 18+, modern browsers, edge runtimes.

## Why

A store that prices in one currency and sells to shoppers paying in another has to do two things:

1. **Show a sensible price.** Converting ₦14,000 at today's rate gives €9.8140. Nobody wants to pay that. You want €10.99.
2. **Charge exactly that price.** If checkout converts the cart's *subtotal*, it won't equal the sum of the prices the shopper saw on each product. Whatever the payment page says then looks like a bait-and-switch.

There's also a third thing that's easy to miss. A percentage margin can't cover a fixed fee per payment, like Stripe's 20p on a UK card. A €9.82 test order on a US card, with a 5% margin, still lost money. Every item needs a small minimum markup as well.

`charmfx` handles all three. This code was taken out of the SalesCenta checkout, where it prices orders from Nigerian stores for shoppers who pay in pounds, euros and dollars.

## Quick start

```ts
import { charmfx } from '@dozie_melvin96/charmfx';

const pricing = charmfx({
  margins: { EUR: 0.05 },   // convert at the market rate +5%
  minMarkup: { EUR: 35 },   // and at least 35 cents per item
});

const rate = 0.000701; // 1 NGN = 0.000701 EUR, from your rates provider

pricing.price(1_400_000, { from: 'NGN', to: 'EUR', rate });
// → 1099  (€10.99)

const quote = pricing.quote({
  from: 'NGN',
  to: 'EUR',
  rate,
  lines: [{ unitPrice: 1_400_000, quantity: 2 }],
  shipping: 300_000,
});

quote.lines;        // [{ unitPrice: 1099, quantity: 2, total: 2198 }]
quote.total;        // 2497 — charge this
quote.source.total; // 3100000 — record this on the order, in the store's currency
```

Use the same config in your storefront and on your server. The price on the product page and the amount you charge then come from the same function.

## Amounts are minor units

Every amount you pass in or get back is a whole number in the currency's **minor unit**: cents, pence, kobo. `1099` EUR means €10.99. `1580` JPY means ¥1,580, because yen has no decimal places. `3990` KWD means KWD 3.990, because the Kuwaiti dinar has three.

These are the amounts Stripe, Adyen and most payment providers expect. Decimal places come from the runtime's `Intl` data, so you don't keep a table yourself.

If your prices are stored as decimals (`"14000.00"`), convert them first:

```ts
import { toMinor, fromMinor } from '@dozie_melvin96/charmfx';

toMinor('14000.00', 'NGN'); // 1400000
toMinor(1.005, 'USD');      // 101 — float noise cleared first, not 100
fromMinor(1099, 'EUR');     // 10.99
```

**Rates** are quoted the usual way: units of `to` per one unit of `from`. 1 NGN = 0.000701 EUR is a rate of `0.000701`. The margin is added for you, so pass the market rate.

## How a checkout is priced

| Part | Rule |
| --- | --- |
| Each item | converted, rounded **up**, plus the minimum markup, then up to the next price ending |
| Subtotal | the sum of each item's shown price × quantity, **never** a conversion of the store's subtotal |
| Shipping | converted, rounded up to the price ending, no markup |
| Discount | converted and rounded **down**, never more than subtotal + shipping |
| Tax, inclusive | already inside the prices: converted and reported, not added |
| Tax on top | converted, rounded up, added to the total |

Every rounding goes the store's way: charges round up, discounts round down.

## Configuration

```ts
charmfx({
  rounding: 'charm',
  roundingByCurrency: { JPY: { step: 100, ending: 80 } },
  margins: { GBP: 0.04, EUR: 0.05, USD: 0.055 },
  minMarkup: { GBP: 30, EUR: 35, USD: 40 },
  decimals: { HUF: 0 },
});
```

All keys are currency codes. Any currency without an entry gets no margin, no markup and the default rounding.

### `rounding`

How shown prices end. The default is `'charm'`. For converted amounts of €10.143, KWD 3.0705 and ¥1,512.34:

| Value | EUR (2 decimals) | KWD (3 decimals) | JPY (0 decimals) |
| --- | --- | --- | --- |
| `'charm'` | 10.99 | 3.990 | 1,513 (no decimals, so whole yen) |
| `'whole'` | 11.00 | 4.000 | 1,513 |
| `'none'` | 10.15 | 3.071 | 1,513 |
| `{ step, ending }` | your rule | your rule | your rule |

A custom rule lands on the next amount whose remainder after dividing by `step` is `ending`, both in minor units:

```ts
{ step: 100, ending: 95 }    // 10.95, 11.95 …
{ step: 100, ending: 80 }    // ¥1,980, ¥2,080 …
{ step: 50_000, ending: 0 }  // next ₦500
```

### `margins`

A fraction added to the rate for each currency. `{ GBP: 0.04 }` converts at the market rate plus 4%. Set it to cover card fees and the cost of converting the money back.

### `minMarkup`

The smallest amount, in the shopper's minor units, that an item's shown price sits above its converted amount before rounding. This is what covers a fixed per-payment fee on cheap items.

### `decimals`

Overrides a currency's decimal places, for when your payment provider writes amounts differently from ISO 4217. Stripe, for example, expects ISK as a two-decimal amount ending in 00: `decimals: { ISK: 2 }` with `roundingByCurrency: { ISK: 'whole' }`. Check your provider's list of special cases.

## API

### `charmfx(config?)`

Checks the config straight away and throws a `RangeError` if anything is wrong, so a typo fails at startup rather than at checkout. Returns:

- **`price(amount, { from, to, rate })`**: one item's shown price.
- **`quote({ from, to, rate, lines, shipping?, discount?, tax? })`**: a whole checkout. `tax` is `{ amount, inclusive }`. It returns the shown `lines`, `subtotal`, `shipping`, `discount`, `tax`, `total`, the `rate` it used (margin included), and `source`, the same totals in the store's currency.
- **`effectiveRate(rate, to)`**: the rate with `to`'s margin added.
- **`toMinor(amount, code)`**, **`format(minor, code, locale?)`**, **`decimals(code)`**: the helpers below, with your `decimals` overrides applied.

When `from` and `to` are the same currency, amounts pass through unchanged. Bad rates (zero, negative, `NaN`), bad quantities and anything that isn't a three-letter currency code throw a `RangeError`.

### Helpers

```ts
import {
  crossRates, formatMinor, currencyDecimals, roundToEnding,
} from '@dozie_melvin96/charmfx';

// Rates against USD → rates from NGN
crossRates({ NGN: 1600, GBP: 0.79 }, 'USD', 'NGN', ['GBP']);
// { GBP: 0.00049375 } — a currency with no rate is left out, never guessed

formatMinor(1_400_000, 'NGN');               // "₦14,000.00"
formatMinor(1099, 'EUR');                    // "€10.99"
formatMinor(1099, 'EUR', { locale: 'de-DE' }); // "10,99 €"

currencyDecimals('KWD'); // 3

roundToEnding(982, { step: 100, ending: 99 }, 35); // 1099
```

`formatMinor` writes each currency the way it is written at home unless you pass a locale. Without that, many runtimes print `NGN 14,000.00` instead of `₦14,000.00`.

### Rates from ExchangeRate-API

```ts
import { parseExchangeRateApi } from '@dozie_melvin96/charmfx/exchangerate-api';

const res = await fetch(`https://v6.exchangerate-api.com/v6/${key}/latest/USD`);
const { base, rates, publishedAt } = parseExchangeRateApi(await res.json());
const fromNaira = crossRates(rates, base, 'NGN', ['GBP', 'EUR', 'USD']);
```

The parser throws on an error response or an empty body, so you can keep your last good rates. A refresh that "succeeded" with nothing would take every foreign currency off your store.

## Recipes

### Charge with Stripe

```ts
const quote = pricing.quote({ from: 'NGN', to: 'GBP', rate, lines, shipping });

await stripe.paymentIntents.create({
  amount: quote.total,
  currency: quote.currency.toLowerCase(),
  metadata: { store_total: String(quote.source.total), fx_rate: String(quote.rate) },
});
```

### Keep the shown price and the charge in step

Prices only match if the storefront and the server use the **same rate**. Refresh rates on a schedule (daily is plenty), store them, and send the storefront the same numbers the server will quote with. Don't fetch a live rate at checkout.

## License

MIT
