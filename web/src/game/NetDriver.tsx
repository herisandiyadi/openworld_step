import { useEffect } from 'react';
import { currentMode, onVehicleUpdate, setLocalState, tick } from '../net/netRuntime';
import { useGameStore } from '../state/gameStore';
import { groundHeightAt } from '../world/worldState';
import { jumpState, playerMotion, playerState } from './runtime';
import { SEND_INTERVAL_MS, localSnapshot } from './netDriver';
import { applyVehicleUpdate, resetSharedVehicles } from './sharedVehicles';

/**
 * Menjalankan sesi multiplayer di luar render loop: state pemain lokal dikirim 15 Hz dan
 * HostSession di-tick. Sengaja pakai interval, bukan useFrame, karena Canvas berhenti
 * menggambar saat game dijeda sementara host tetap harus melayani pemain lain.
 * Tanpa sesi (single-player) setiap tick langsung kembali tanpa efek.
 */
export function NetDriver(): null {
  useEffect(() => {
    const stopVehicles = onVehicleUpdate(applyVehicleUpdate);
    const timer = window.setInterval(() => {
      if (currentMode() === null) return;
      const game = useGameStore.getState();
      setLocalState(
        localSnapshot(
          {
            x: playerState.x,
            y: groundHeightAt(playerState.x, playerState.z) + jumpState.y,
            z: playerState.z,
            heading: playerState.heading,
          },
          {
            mode: game.mode,
            speed: playerMotion.speed,
            seated: game.seated,
            jumping: jumpState.y > 0 || jumpState.vy !== 0,
          },
        ),
      );
      tick();
    }, SEND_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      stopVehicles();
      resetSharedVehicles();
    };
  }, []);
  return null;
}
