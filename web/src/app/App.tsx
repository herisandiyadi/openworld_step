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
import { MultiplayerMenu } from '../ui/MultiplayerMenu';
import { RemotePlayers } from '../game/RemotePlayers';
import { ChatBubbles } from '../ui/ChatBubbles';
import { NetDriver } from '../game/NetDriver';
import { usePlayerProfile } from '../state/profile';
import { useAiSettings } from '../state/aiSettings';
import { QUALITY_PRESETS, type Quality, useGameStore } from '../state/gameStore';
import { RenderFoundation } from '../render/RenderFoundation';
import { VisualEffects } from '../render/VisualEffects';
import { SceneLighting } from '../render/SceneLighting';
import { QuestSignals } from '../game/QuestSignals';
import { initQuests } from '../game/questRuntime';
import { initJobs } from '../game/jobRuntime';
import { useContentProgress } from '../state/contentProgress';

import { ensureContentBooted } from './contentBoot';

const SKY_COLOR = '#bcd3e6';
preloadAssets();
void useAiSettings.getState().load();
void usePlayerProfile.getState().load();
installAudio();

// Boot content runtime: activate any staged pack, then load bundled or active content.
void ensureContentBooted().then((pack) => {
  initQuests(pack.registry);
  initJobs(pack.registry, pack.economy);
  const today = new Date().toISOString().slice(0, 10);
  useContentProgress.getState().rollDailyState(today);
  useContentProgress.getState().claimDailyBonus(today, pack.economy?.dailyBonus ?? 0);
  useContentProgress.getState().setContentVersion(pack.manifest.version);
}).catch((error) => console.error('[content] Boot failed:', error));

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
  if (screen === 'multiplayer') return <MultiplayerScreen />;
  return <Game />;
}

/** Menu "Main bersama"; Mulai main melanjutkan dunia yang sedang dimuat tanpa menghapus save. */
function MultiplayerScreen() {
  const setScreen = useGameStore((state) => state.setScreen);
  return (
    <MultiplayerMenu
      onBack={() => setScreen('title')}
      onStart={() => setScreen('game')}
      onOpenSettings={() => setScreen('settings')}
    />
  );
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
          <RemotePlayers />
        </Suspense>
        <ChatBubbles />
        <TapToMove />
        <Proximity />
        <AudioFrame />
        <RenderStats />
        {soakActive && <SoakTest />}
      </Canvas>
      <Hud />
      <QuestSignals />
      <LoadingScreen />
      <AudioDirector />
      <NetDriver />
      {!soakActive && <AutoSave />}
    </div>
  );
}