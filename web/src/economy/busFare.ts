import { debit, type Wallet } from './wallet';

export interface TransitPass {
  readonly activeDate: string | null;
}

export type FareResult =
  | { readonly ok: true; readonly wallet: Wallet; readonly charged: number }
  | { readonly ok: false; readonly reason: 'insufficient-funds'; readonly wallet: Wallet };

export type PassPurchaseResult =
  | { readonly ok: true; readonly wallet: Wallet; readonly pass: TransitPass }
  | { readonly ok: false; readonly reason: 'insufficient-funds'; readonly wallet: Wallet; readonly pass: TransitPass };

const validDate = (date: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));

export function createTransitPass(activeDate: string | null = null): TransitPass {
  if (activeDate !== null && !validDate(activeDate)) throw new RangeError('activeDate must be YYYY-MM-DD');
  return { activeDate };
}

export function busFare(configuredFare: number): number {
  return Number.isInteger(configuredFare) && configuredFare > 0 ? configuredFare : 0;
}

export function rideBus(wallet: Wallet, configuredFare: number, hasValidDayPass: boolean, transaction?: { readonly id?: string; readonly timestamp?: number }): FareResult {
  const fare = hasValidDayPass ? 0 : busFare(configuredFare);
  if (fare === 0) return { ok: true, wallet, charged: 0 };
  const payment = debit(wallet, fare, 'bus:ride', transaction?.id, transaction?.timestamp);
  if (!payment.ok) return { ok: false, reason: 'insufficient-funds', wallet };
  return { ok: true, wallet: payment.wallet, charged: fare };
}

export function buyDayPass(wallet: Wallet, price: number, date: string, transaction?: { readonly id?: string; readonly timestamp?: number }): PassPurchaseResult {
  if (!validDate(date)) throw new RangeError('date must be YYYY-MM-DD');
  const pass = createTransitPass();
  const payment = debit(wallet, busFare(price), 'bus:day-pass', transaction?.id, transaction?.timestamp);
  if (!payment.ok) return { ok: false, reason: 'insufficient-funds', wallet, pass };
  return { ok: true, wallet: payment.wallet, pass: { activeDate: date } };
}
