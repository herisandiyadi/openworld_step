import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { World } from '../world/World';
import { preloadAssets } from './assets';
import { LoadingScreen } from '../ui/LoadingScreen';
import { PlayerController } from '../game/PlayerController';
import { TapToMove } from '../game/TapToMove';
import { Proximity } from '../game/Proximity';
import { ParkedVehicles } from '../game/ParkedVehicles';
import { DayNight } from '../game/DayNight';
import { AutoSave } from '../game/AutoSave';
import { AudioDirector, AudioFrame } from '../audio/AudioDirector';
import { installAudio } from '../audio/install';
import { useKeyboardInput } from '../game/useKeyboardInput';
import { RenderStats } from './RenderStats';
import { SOAK_FROM_URL, SoakTest } from './SoakTest';
import { Hud } from '../ui/Hud';
import { TitleScreen } from '../ui/TitleScreen';
import { SettingsScreen } from '../ui/SettingsScreen';
import { ProfileScreen } from '../ui/ProfileScreen';
import { usePlayerProfile } from '../state/profile';
import { useAiSettings } from '../state/aiSettings';
import { QUALITY_PRESETS, type Quality, useGameStore } from '../state/gameStore';
import { RenderFoundation } from '../render/RenderFoundation';
import { VisualEffects } from '../render/VisualEffects';
import { SceneLighting } from '../render/SceneLighting';

const SKY_COLOR = '#bcd3e6';
preloadAssets();
void useAiSettings.getState().load();
void usePlayerProfile.getState().load();
installAudio();
if (SOAK_FROM_URL) useGameStore.setState({ screen: 'game', soakActive: true });

const DOWNGRADE: Record<Quality, Quality> = { high: 'medium', medium: 'low', low: 'low' };

export function App() {
  const screen = useGameStore((state) => state.screen);
  const profileLoaded = usePlayerProfile((state) => state.loaded);
  const hasProfile = usePlayerProfile((state) => state.profile !== null);
  // ?soak goes straight to the game; everyone else picks a username once after install.
  if (screen === 'game') return <Game />;
  if (!profileLoaded) {
    return (
      <main className="menu-screen">
        <p className="menu-status" role="status">
          Memuat...
        </p>
      </main>
    );
  }
  if (!hasProfile) return <ProfileScreen firstRun />;
  if (screen === 'profile') return <ProfileScreen />;
  if (screen === 'title') return <TitleScreen />;
  if (screen === 'settings') return <SettingsScreen />;
  return <Game />;
}

/** The 3D world + HUD, mounted only after the player presses Mulai. */
function Game() {
  useKeyboardInput();
  const quality = useGameStore((state) => state.quality);
  const paused = useGameStore((state) => state.paused || state.chatNpcId !== null || state.busMenuOpen);
  const setQuality = useGameStore((state) => state.setQuality);
  const soakActive = useGameStore((state) => state.soakActive);
  const preset = QUALITY_PRESETS[quality];
  const maxDpr = Math.min(window.devicePixelRatio || 1, preset.maxDpr);

  return (
    <div className="game-root">
      <Canvas
        className="game-canvas"
        shadows={preset.shadows}
        dpr={[1, maxDpr]}
        frameloop={paused ? 'never' : 'always'}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ fov: 45, near: 0.5, far: 220, position: [0, 25, 17] }}
      >
        <color attach="background" args={[SKY_COLOR]} />
        <fog attach="fog" args={[SKY_COLOR, 50, 125]} />
        <RenderFoundation tier={quality} />
        <SceneLighting />
        <DayNight />
        <VisualEffects />
        <PerformanceMonitor flipflops={3} onDecline={() => setQuality(DOWNGRADE[useGameStore.getState().quality])} />
        <Suspense fallback={null}>
          <World />
          <PlayerController shadows={preset.shadows} />
          <ParkedVehicles />
        </Suspense>
        <TapToMove />
        <Proximity />
        <AudioFrame />
        <RenderStats />
        {soakActive && <SoakTest />}
      </Canvas>
      <Hud />
      <LoadingScreen />
      <AudioDirector />
      {!soakActive && <AutoSave />}
    </div>
  );
}