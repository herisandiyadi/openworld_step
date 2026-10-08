import { describe, expect, it } from 'vitest';
import { checkWorldVersion, WORLD_VERSION } from '../src/worldVersion.js';

describe('worldVersion compatibility', () => {
  it('accepts a matching server and room version', () => {
    expect(checkWorldVersion(WORLD_VERSION, WORLD_VERSION)).toBeNull();
    expect(checkWorldVersion(WORLD_VERSION, null)).toBeNull();
  });

  it('rejects missing and unsupported create versions clearly', () => {
    expect(checkWorldVersion(null, null)).toEqual({
      status: 400,
      error: 'world-version-required',
      message: 'Perbarui konten dulu: worldVersion wajib dikirim.',
    });
    expect(checkWorldVersion('2.0.0-old-world', null)).toEqual({
      status: 400,
      error: 'world-version-required',
      message: 'Perbarui konten dulu: worldVersion 2.0.0-old-world tidak didukung server ini.',
    });
  });

  it('rejects join when the room was created with a different world version', () => {
    expect(checkWorldVersion(WORLD_VERSION, '2.0.0-old-world')).toEqual({
      status: 409,
      error: 'world-version',
      message: 'Perbarui konten dulu: room memakai worldVersion 2.0.0-old-world.',
    });
  });
});
