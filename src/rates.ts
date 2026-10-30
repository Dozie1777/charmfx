/**
 * Rates from `from` into each of `to`, crossed through the rates' common
 * base. If one USD buys 1,600 NGN and 0.79 GBP, one NGN buys 0.79 / 1,600 GBP.
 *
 * `baseRates` is how providers quote: units of each currency per one unit of
 * `baseCode`. A currency with no rate is left out rather than guessed, so a
 * storefront simply doesn't offer it.
 */
export function crossRates(
  baseRates: Readonly<Record<string, number>>,
  baseCode: string,
  from: string,
  to: readonly string[],
): Record<string, number> {
  const per = (code: string) => (code === baseCode ? 1 : baseRates[code]);
  const fromRate = per(from);
  if (!fromRate) return {};

  const out: Record<string, number> = {};
  for (const code of to) {
    if (code === from) continue;
    const toRate = per(code);
    if (toRate) out[code] = toRate / fromRate;
  }
  return out;
}
