/**
 * Shared by the asset generator (tools/assets) and the runtime so that model geometry,
 * character animation, and in-game motion stay in sync. Units: metres, +Y up, -Z forward.
 */
export const BIKE = {
  wheelRadius: 0.34,
  hubY: 0.34,
  frontHubZ: -0.52,
  rearHubZ: 0.52,
  crankY: 0.32,
  crankZ: 0.02,
  crankLength: 0.16,
  saddleTopY: 0.92,
  saddleZ: 0.22,
  gripX: 0.25,
  gripY: 1.05,
  gripZ: -0.3,
  /** Virtual gearing: metres travelled per crank revolution. */
  metersPerCrankTurn: 5,
} as const;

export const SKATE = {
  deckTopY: 0.12,
} as const;

/** Clip lengths (s) and the ground speed (m/s) each locomotion clip was authored for. */
export const ANIM = {
  idleCycle: 3,
  walkCycle: 1.1,
  walkSpeed: 1.5,
  runCycle: 0.7,
  runSpeed: 4.5,
  skateCycle: 2,
  /** One full crank revolution. */
  bikeCycle: 0.8,
  talkCycle: 2.4,
} as const;