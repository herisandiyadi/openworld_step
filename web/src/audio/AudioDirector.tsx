import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { audio } from './audioEngine';
import { jumpState, playerMotion } from '../game/runtime';
import { useGameStore } from '../state/gameStore';

type StoreState = ReturnType<typeof useGameStore.getState>;

const isBlocked = (state: StoreState) =>
  state.paused || state.chatNpcId !== null || state.busMenuOpen || state.mapOpen;

/** Music while in the game; ducks for menus/chat/map and plays the quest jingle. Mounted outside the Canvas. */
export function AudioDirector() {
  useEffect(() => {
    audio.unlock();
    audio.startMusic();
    const apply = (state: StoreState) => {
      const blocked = isBlocked(state);
      audio.setDucked(blocked);
      audio.setLoopsActive(!blocked);
    };
    apply(useGameStore.getState());
    const unsubscribe = useGameStore.subscribe((state, previous) => {
      apply(state);
      if (state.met.length > previous.met.length) audio.quest();
    });
    return () => {
      unsubscribe();
      audio.stopMusic();
      audio.setLoopsActive(false);
      audio.setDucked(false);
    };
  }, []);
  return null;
}

/** Feeds the player's speed to footsteps / wheel / engine sounds every frame. Mounted inside the Canvas. */
export function AudioFrame() {
  useFrame((_, delta) => {
    audio.updateMotion(useGameStore.getState().mode, playerMotion.speed, Math.min(delta, 0.05), jumpState.y > 0);
  });
  return null;
}