/**
 * Material langit prosedural: gradient + cloud band + stars, semuanya analitik.
 * Tanpa texture dan tanpa seam: semua noise dihitung dari arah pandang (unit vector),
 * jadi tidak ada jahitan UV vertikal atau dome arc yang terlihat.
 */
import { BackSide, Color, ShaderMaterial } from 'three';

export interface SkyUniformValues {
  horizon: Color;
  zenith: Color;
  stars: number;
  clouds: number;
  time: number;
}

export function createSkyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    // Langit tidak boleh ikut fog scene; warnanya sendiri yang jadi acuan fog.
    fog: false,
    toneMapped: true,
    uniforms: {
      uHorizon: { value: new Color('#c4d9e8') },
      uZenith: { value: new Color('#78b6e3') },
      uStars: { value: 0 },
      uClouds: { value: 0.5 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform float uStars;
      uniform float uClouds;
      uniform float uTime;
      varying vec3 vDirection;

      // Hash/noise 3D berbasis arah: kontinu di seluruh sphere, jadi tanpa seam.
      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }

      float fbm(vec3 p) {
        float sum = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 4; i++) {
          sum += amplitude * noise(p);
          p *= 2.02;
          amplitude *= 0.5;
        }
        return sum;
      }

      void main() {
        vec3 dir = normalize(vDirection);
        // Gradient halus dari horizon ke zenith; pow membuat transisi tidak terlihat sebagai garis.
        float height = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        // t = 0 tepat di horizon (dir.y = 0) supaya warna dome sama persis dengan fog.
        float t = pow(smoothstep(0.5, 1.0, height), 0.8);
        vec3 color = mix(uHorizon, uZenith, t);

        // Stars: hanya di atas horizon, kerapatan dari hash arah, redup ke arah horizon.
        if (uStars > 0.001) {
          vec3 cell = dir * 180.0;
          float star = hash(floor(cell));
          float spark = smoothstep(0.9975, 1.0, star);
          float twinkle = 0.75 + 0.25 * sin(uTime * 2.0 + star * 90.0);
          color += vec3(0.85, 0.9, 1.0) * spark * twinkle * uStars * smoothstep(0.0, 0.25, dir.y);
        }

        // Cloud layer: fbm pada arah yang diproyeksikan, bergerak lambat. Soft, tanpa hard edge.
        float band = smoothstep(0.03, 0.45, dir.y);
        vec3 cloudDir = dir / max(0.25, dir.y + 0.35);
        float cloud = fbm(cloudDir * 1.6 + vec3(uTime * 0.012, 0.0, uTime * 0.008));
        cloud = smoothstep(0.52, 0.95, cloud) * band * uClouds;
        color = mix(color, color * 0.86 + vec3(0.72, 0.76, 0.8) * 0.5, cloud);

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
