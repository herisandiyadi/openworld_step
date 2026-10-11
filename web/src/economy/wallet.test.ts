import { describe, expect, it } from 'vitest';
import { credit, createWallet, debit, transact } from './wallet';

describe('wallet', () => {
  it('returns a new wallet for a credit and records the transaction', () => {
    const wallet = createWallet(10);
    const result = credit(wallet, 5, 'quest:q_intro', 'tx-1', 100);
    expect(result).toEqual({
      ok: true,
      wallet: {
        balance: 15,
        ledger: [{ id: 'tx-1', amount: 5, balance: 15, reason: 'quest:q_intro', timestamp: 100 }],
      },
    });
    expect(wallet).toEqual({ balance: 10, ledger: [] });
  });

  it('rejects a debit that would make the balance negative without changing the wallet', () => {
    const wallet = createWallet(4);
    expect(debit(wallet, 5, 'store:item', 'tx-2', 101)).toEqual({
      ok: false,
      reason: 'insufficient-funds',
      wallet,
    });
  });

  it('keeps only the newest 100 ledger entries', () => {
    let wallet = createWallet();
    for (let i = 0; i < 105; i += 1) {
      const result = transact(wallet, 1, `reward:${i}`, `tx-${i}`, i);
      if (!result.ok) throw new Error('credit unexpectedly failed');
      wallet = result.wallet;
    }
    expect(wallet.balance).toBe(105);
    expect(wallet.ledger).toHaveLength(100);
    expect(wallet.ledger[0]?.id).toBe('tx-5');
    expect(wallet.ledger.at(-1)?.id).toBe('tx-104');
  });

  it('rejects zero, fractional, and non-finite coin transactions', () => {
    const wallet = createWallet(3);
    for (const amount of [0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(transact(wallet, amount, 'invalid')).toMatchObject({ ok: false, reason: 'invalid-amount', wallet });
    }
  });
});
