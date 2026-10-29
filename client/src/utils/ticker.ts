/**
 * @file client/src/utils/ticker.ts
 * @description Ticker symbol normalization across the app's storage forms.
 *
 * The same stock appears under different spellings across data sources:
 * holdings store HK tickers zero-padded to 4 digits ('0700'), quote
 * providers return 5-digit codes ('00700') or suffixed forms ('700.HK'),
 * CN quotes come back suffixed ('600519.SH') while holdings keep the bare
 * code. Every consumer that needs to look a quote up by a holding's ticker
 * (or vice versa) resolves through {@link tickerVariants}, which enumerates
 * all equivalent spellings — so indexing a map by any variant of the symbol
 * makes every other variant hit as well.
 */
import type { Market } from '@shared/api.interface';

/**
 * All equivalent spellings of a ticker.
 *  - HK: '0700' -> ['0700', '00700', '700', '700.HK', '00700.HK']
 *  - CN: '600519.SH' -> ['600519.SH', '600519']
 *  - US: 'NVDA' -> ['NVDA'] (uppercase passthrough)
 * The input itself is always included.
 */
export function tickerVariants(rawTicker: string, _market?: Market): string[] {
  const s = (rawTicker ?? '').trim().toUpperCase();
  const out = new Set<string>([s]);

  // Hong Kong: 1-5 digit codes with optional .HK suffix.
  const hkMatch = /^(\d{1,5})(?:\.HK)?$/.exec(s);
  if (hkMatch) {
    const digits = hkMatch[1];
    const unpadded = digits.replace(/^0+/, '') || digits;
    out.add(unpadded); // '700'
    out.add(unpadded.padStart(4, '0')); // '0700' (holdings storage form)
    out.add(unpadded.padStart(5, '0')); // '00700' (provider form)
    out.add(`${unpadded}.HK`);
    out.add(`${unpadded.padStart(5, '0')}.HK`);
    out.add(digits);
  }

  // China A-shares: 6-digit code with optional .SH/.SZ/.BJ suffix.
  const cnMatch = /^(\d{6})(?:\.(SH|SZ|BJ))?$/.exec(s);
  if (cnMatch) {
    const code = cnMatch[1];
    out.add(code); // bare form (holdings storage)
    out.add(`${code}.${cnMatch[2] ?? 'SH'}`); // provider form
  }

  return [...out];
}
