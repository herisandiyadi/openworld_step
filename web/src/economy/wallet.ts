/** Immutable coin wallet for U2b. All balances are whole, non-negative coins. */

export interface LedgerEntry {
  readonly id: string;
  readonly amount: number;
  readonly balance: number;
  readonly reason: string;
  readonly timestamp: number;
}

export interface Wallet {
  readonly balance: number;
  readonly ledger: readonly LedgerEntry[];
}

export type WalletResult =
  | { readonly ok: true; readonly wallet: Wallet }
  | { readonly ok: false; readonly reason: 'invalid-amount' | 'insufficient-funds'; readonly wallet: Wallet };

const MAX_LEDGER_ENTRIES = 100;

export function createWallet(balance = 0): Wallet {
  if (!Number.isInteger(balance) || balance < 0) throw new RangeError('wallet balance must be a non-negative integer');
  return { balance, ledger: [] };
}

function validAmount(amount: number): boolean {
  return Number.isInteger(amount) && Number.isFinite(amount) && amount > 0;
}

export function transact(wallet: Wallet, amount: number, reason: string, id = `${reason}-${wallet.ledger.length}`, timestamp = Date.now()): WalletResult {
  if (!validAmount(amount)) return { ok: false, reason: 'invalid-amount', wallet };
  const nextBalance = wallet.balance + amount;
  const entry: LedgerEntry = { id, amount, balance: nextBalance, reason, timestamp };
  return { ok: true, wallet: { balance: nextBalance, ledger: [...wallet.ledger, entry].slice(-MAX_LEDGER_ENTRIES) } };
}

export function credit(wallet: Wallet, amount: number, reason: string, id?: string, timestamp?: number): WalletResult {
  return transact(wallet, amount, reason, id, timestamp);
}

export function debit(wallet: Wallet, amount: number, reason: string, id = `${reason}-${wallet.ledger.length}`, timestamp = Date.now()): WalletResult {
  if (!validAmount(amount)) return { ok: false, reason: 'invalid-amount', wallet };
  if (amount > wallet.balance) return { ok: false, reason: 'insufficient-funds', wallet };
  const nextBalance = wallet.balance - amount;
  const entry: LedgerEntry = { id, amount: -amount, balance: nextBalance, reason, timestamp };
  return { ok: true, wallet: { balance: nextBalance, ledger: [...wallet.ledger, entry].slice(-MAX_LEDGER_ENTRIES) } };
}
