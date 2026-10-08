import { describe, it, expect, beforeEach } from 'vitest';
import { useContentProgress } from '../state/contentProgress';
import { useGameStore } from '../state/gameStore';
import { payBusFare } from './transitActions';

describe('transitActions.payBusFare', () => {
  beforeEach(() => {
    useContentProgress.setState({
      coins: 10,
      ledger: [],
      transitPass: { activeDate: null },
      quests: [],
    });
    useGameStore.setState({ busRide: null });
  });

  it('charges the configured fare when no day pass is held', () => {
    const fare = useContentProgress.getState().coins;
    expect(payBusFare(5)).toBe(true);
    expect(useContentProgress.getState().coins).toBe(fare - 5);
  });

  it('does not charge when a valid day pass is held', () => {
    const today = new Date().toISOString().slice(0, 10);
    useContentProgress.setState({ transitPass: { activeDate: today } });
    expect(payBusFare(5)).toBe(true);
    expect(useContentProgress.getState().coins).toBe(10);
  });

  it('blocks the ride when the player cannot afford the fare', () => {
    useContentProgress.setState({ coins: 0 });
    expect(payBusFare(5)).toBe(false);
    expect(useGameStore.getState().busRide).toBeNull();
  });

  it('never charges a zero configured fare', () => {
    useContentProgress.setState({ coins: 10 });
    expect(payBusFare(0)).toBe(true);
    expect(useContentProgress.getState().coins).toBe(10);
  });

  it('buys a day pass for the configured price', () => {
    useContentProgress.setState({ coins: 30 });
    expect(buyDayPassAction(30)).toBe(true);
    expect(useContentProgress.getState().coins).toBe(0);
    expect(useContentProgress.getState().transitPass.activeDate).not.toBeNull();
  });
});

import { buyDayPassAction } from './transitActions';
