import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Fog, Mesh, SphereGeometry, type HemisphereLight, type PointLight } from 'three';
import { dayClock, playerState } from '../game/runtime';
import { daylightAt } from '../game/dayCycle';
import { lightingAt } from '../game/lighting';
import { skyPalette } from './sky';
import { createSkyMaterial } from './skyMaterial';
import { setWindowEmission } from './windowShader';
import { streetLampBudget, nearestLamps } from './streetLights';
import { allStreetLampPositions } from './streetLampRegistry';
import { useGameStore } from '../state/gameStore';

const SKY_RADIUS = 180;
const LAMP_MAX_DISTANCE = 44;
const LAMP_HEIGHT_OFFSET = 3.2;
const NIGHT_LAMP_FACTOR = 1.5;

/** Langit procedural yang mengikuti pemain; horizon dan fog memakai warna palette yang sama. */
export function SceneLighting() {
  const scene = useThree((state) => state.scene);
  const quality = useGameStore((state) => state.quality);
  const skyRef = useRef<Mesh>(null);
  const hemiRef = useRef<HemisphereLight>(null);
  const lampRefs = useRef<Array<PointLight | null>>([]);
  const material = useMemo(() => createSkyMaterial(), []);
  const geometry = useMemo(() => new SphereGeometry(SKY_RADIUS, 48, 24), []);
  const scratch = useMemo(() => ({
    zenith: new Color(),
    ground: new Color(),
  }), []);
  const lampCount = streetLampBudget(quality);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame((_, delta) => {
    const { daylight, dusk } = daylightAt(dayClock.t);
    const sample = lightingAt(dayClock.t);
    const colors = skyPalette(daylight, dusk);
    const uniforms = material.uniforms;
    uniforms.uHorizon?.value?.copy(colors.horizon);
    uniforms.uZenith?.value?.copy(colors.zenith);
    if (uniforms.uStars) uniforms.uStars.value = colors.stars;
    if (uniforms.uClouds) uniforms.uClouds.value = colors.clouds;
    if (uniforms.uTime) uniforms.uTime.value += Math.min(delta, 0.05);

    if (skyRef.current) skyRef.current.position.set(playerState.x, 0, playerState.z);
    if (scene.fog instanceof Fog) scene.fog.color.copy(colors.fog);
    // Color background remains as fallback if the sky mesh is clipped during camera transitions.
    if (scene.background instanceof Color) scene.background.copy(colors.horizon);
    // Drive window emissive from the same day/night curve as the sky.
    setWindowEmission(daylight);

    if (hemiRef.current) {
      hemiRef.current.intensity = sample.hemisphereIntensity;
      hemiRef.current.color.copy(scratch.zenith.copy(colors.zenith));
      hemiRef.current.groundColor.copy(scratch.ground.set(daylight > 0.2 ? '#8a8f78' : '#20283a'));
    }

    const nearby = nearestLamps(allStreetLampPositions(), playerState.x, playerState.z, lampCount, LAMP_MAX_DISTANCE);
    for (let index = 0; index < lampRefs.current.length; index++) {
      const light = lampRefs.current[index];
      const lamp = nearby[index];
      if (!light) continue;
      light.visible = !!lamp && daylight < 0.25;
      if (lamp) light.position.set(lamp.x, lamp.y + LAMP_HEIGHT_OFFSET, lamp.z);
      light.intensity = daylight < 0.25 ? sample.streetLight * NIGHT_LAMP_FACTOR : 0;
    }
  });

  return <>
    <mesh
      ref={skyRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={-1000}
    />
    <hemisphereLight ref={hemiRef} args={['#cfe4f7', '#8a8f78', 0.9]} />
    {/* Pooled practical lights: tier budget caps how many exist, positions follow the player. */}
    {Array.from({ length: 6 }, (_, index) => (
      <pointLight
        key={index}
        ref={(light) => { lampRefs.current[index] = light; }}
        color="#ffb45c"
        distance={18}
        decay={2}
        castShadow={false}
        visible={false}
      />
    ))}
  </>;
}
