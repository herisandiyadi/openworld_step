/**
 * Jendela gedung bervariasi (menyala/mati) tanpa mengubah chunkStreamer: pola dihitung di shader
 * dari posisi world, dengan hash yang sama seperti windowCellLit (windows.ts).
 */
import type { MeshStandardMaterial } from 'three';
import { WINDOW_LIT_RATIO, windowEmissionAt } from './windows';

const INSTALLED = new WeakSet<MeshStandardMaterial>();
const WINDOW_UNIFORMS = { uWindowEmission: { value: windowEmissionAt(1) } };

/** Set the day/night emissive multiplier without forcing the material to recompile. */
export function setWindowEmission(daylight: number): void {
  WINDOW_UNIFORMS.uWindowEmission.value = windowEmissionAt(daylight);
}

export function installWindowShader(material: MeshStandardMaterial): void {
  if (INSTALLED.has(material)) return;
  INSTALLED.add(material);
  // Base emissive color; the shader drives per-pane brightness and daylight gating.
  material.emissive.set('#ffd9a0');
  material.emissiveIntensity = 1;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindowEmission = WINDOW_UNIFORMS.uWindowEmission;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWinPos;\nvarying vec3 vWinNormal;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWinPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vWinNormal = mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal;
        #else
          vWinPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWinNormal = mat3(modelMatrix) * objectNormal;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWindowEmission;
        varying vec3 vWinPos;
        varying vec3 vWinNormal;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 wn = normalize(vWinNormal);
          // Hanya facade vertikal; atap tidak punya jendela.
          float side = 1.0 - step(0.5, abs(wn.y));
          vec3 tangent = normalize(cross(vec3(0.0, 1.0, 0.0), wn + vec3(1e-4, 0.0, 0.0)));
          vec2 facade = vec2(dot(vWinPos, tangent), vWinPos.y);
          vec2 grid = facade / vec2(2.4, 3.2);
          vec2 cell = floor(grid);
          vec2 f = fract(grid);
          float pane = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.78);
          float h = fract(sin(cell.x * 12.9898 + cell.y * 78.233 + dot(floor(vWinPos.xz / 40.0), vec2(3.1, 7.7))) * 43758.5453);
          float lit = step(h, ${WINDOW_LIT_RATIO.toFixed(3)}) * step(2.6, vWinPos.y);
          // Variasi hangat-netral dan kecerahan antarjendela.
          vec3 tint = mix(vec3(1.0, 0.86, 0.62), vec3(0.95, 0.95, 1.0), step(0.8, fract(h * 13.0)));
          totalEmissiveRadiance = side * pane * lit * tint * uWindowEmission * (0.65 + 0.7 * fract(h * 7.0));
        }`,
      );
  };
  material.customProgramCacheKey = () => 'building-windows-v1';
  material.needsUpdate = true;
}
