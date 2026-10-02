import { Suspense, useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { useCharacter } from '../game/character';
import { applyAppearance, heroAssetId } from '../game/HeroAppearance';
import type { Appearance } from '../state/profile';

/** Dipakai pointer handler untuk memutar model dan meminta satu frame baru. */
interface Handle {
  group: Group | null;
  invalidate: () => void;
}

/** Model hero dengan penampilan yang sama persis seperti di game (applyAppearance yang sama). */
function PreviewHero({ appearance, handle }: { appearance: Appearance; handle: { current: Handle } }) {
  const { scene, mixer, actions } = useCharacter(heroAssetId(appearance));
  const group = useRef<Group>(null);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    handle.current = { group: group.current, invalidate };
    applyAppearance(scene, appearance);
    // ponytail: pose idle dibekukan di satu frame karena frameloop="demand" (hemat baterai).
    // Kalau idle perlu bergerak, panggil invalidate() berkala selama layar profil terbuka.
    actions.get('anim_Idle')?.reset().play();
    mixer.update(0.25);
    invalidate();
  }, [scene, appearance, actions, mixer, invalidate, handle]);

  return (
    <group ref={group} rotation={[0, Math.PI, 0]}>
      <primitive object={scene} />
    </group>
  );
}

/** Canvas kecil terpisah, frameloop="demand": digambar ulang hanya saat pilihan berubah atau diputar. */
export function CharacterPreview({ appearance }: { appearance: Appearance }) {
  const handle = useRef<Handle>({ group: null, invalidate: () => {} });
  const drag = useRef<number | null>(null);

  return (
    <div
      className="character-preview"
      role="img"
      aria-label="Pratinjau karakter. Geser untuk memutar."
      onPointerDown={(event) => {
        drag.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current === null) return;
        const { group, invalidate } = handle.current;
        if (group) group.rotation.y += (event.clientX - drag.current) * 0.01;
        drag.current = event.clientX;
        invalidate();
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ fov: 30, position: [0, 1.1, 4.2] }} onCreated={({ camera }) => camera.lookAt(0, 0.9, 0)}>
        <hemisphereLight args={['#ffffff', '#8a7f72', 1.6]} />
        <directionalLight position={[2, 4, 3]} intensity={1.4} />
        <Suspense fallback={null}>
          <PreviewHero appearance={appearance} handle={handle} />
        </Suspense>
      </Canvas>
    </div>
  );
}
