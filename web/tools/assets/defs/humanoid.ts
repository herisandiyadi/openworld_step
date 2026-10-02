import type { Document, Node } from '@gltf-transform/core';
import { MeshBuilder } from '../lib/builder';
import { addMesh, createAccessor, createBaseDocument } from '../lib/gltf';
import { solveTwoBone } from '../lib/ik';
import { type Vec3, deg, quatFromEuler } from '../lib/math';
import type { Rgb } from '../lib/palette';
import { ANIM, BIKE, SKATE } from '../../../src/game/vehicleSpec';

export type BoneName =
  | 'root'
  | 'hips'
  | 'spine'
  | 'chest'
  | 'head'
  | 'upperArm_L'
  | 'lowerArm_L'
  | 'upperArm_R'
  | 'lowerArm_R'
  | 'upperLeg_L'
  | 'lowerLeg_L'
  | 'upperLeg_R'
  | 'lowerLeg_R';

interface BoneDef {
  name: BoneName;
  parent: number;
  /** Rest position in model space (rest rotations are identity). */
  rest: Vec3;
}

/** Shared 13-bone humanoid rig. Character faces -Z; its right side is +X. */
export const BONES: BoneDef[] = [
  { name: 'root', parent: -1, rest: [0, 0, 0] },
  { name: 'hips', parent: 0, rest: [0, 0.95, 0] },
  { name: 'spine', parent: 1, rest: [0, 1.05, 0] },
  { name: 'chest', parent: 2, rest: [0, 1.25, 0] },
  { name: 'head', parent: 3, rest: [0, 1.48, 0] },
  { name: 'upperArm_L', parent: 3, rest: [-0.22, 1.42, 0] },
  { name: 'lowerArm_L', parent: 5, rest: [-0.22, 1.14, 0] },
  { name: 'upperArm_R', parent: 3, rest: [0.22, 1.42, 0] },
  { name: 'lowerArm_R', parent: 7, rest: [0.22, 1.14, 0] },
  { name: 'upperLeg_L', parent: 1, rest: [-0.1, 0.92, 0] },
  { name: 'lowerLeg_L', parent: 9, rest: [-0.1, 0.5, 0] },
  { name: 'upperLeg_R', parent: 1, rest: [0.1, 0.92, 0] },
  { name: 'lowerLeg_R', parent: 11, rest: [0.1, 0.5, 0] },
];

const UPPER_ARM = 0.28;
const FOREARM_TO_HAND = 0.265;
const THIGH = 0.42;
const SHIN_TO_SOLE = 0.5;

export function boneIndex(name: BoneName): number {
  const index = BONES.findIndex((bone) => bone.name === name);
  if (index < 0) throw new Error(`Unknown bone ${name}`);
  return index;
}

function boneRest(name: BoneName): Vec3 {
  const bone = BONES[boneIndex(name)];
  if (!bone) throw new Error(`Unknown bone ${name}`);
  return bone.rest;
}

export interface BodySpec {
  skin: Rgb;
  hair: Rgb;
  eye: Rgb;
  shirt: Rgb;
  shirtDark: Rgb;
  pants: Rgb;
  shoe: Rgb;
  sole: Rgb;
  /** Extra rigid parts (backpack, apron, cap...). Use `bone` to attach. */
  extras?: (builder: MeshBuilder) => void;
}

/** Faceted low-poly body, rigidly skinned (one joint per vertex). */
export function buildBody(spec: BodySpec): MeshBuilder {
  const b = new MeshBuilder();
  const down: Vec3 = [Math.PI, 0, 0];
  const limb = (bone: BoneName, length: number, radiusAtJoint: number, radiusAtEnd: number, color: Rgb) =>
    b.frustum(
      { radiusBottom: radiusAtJoint, radiusTop: radiusAtEnd, height: length, segments: 6 },
      { at: boneRest(bone), rot: down, color, bone: boneIndex(bone) },
    );

  b.box([0.32, 0.17, 0.2], { at: [0, 0.94, 0], color: spec.pants, bone: boneIndex('hips') });
  b.box([0.33, 0.2, 0.2], { at: [0, 1.12, 0], color: spec.shirt, bone: boneIndex('spine') });
  b.box([0.4, 0.26, 0.23], { at: [0, 1.33, 0], color: spec.shirt, bone: boneIndex('chest') });
  b.box([0.26, 0.05, 0.2], { at: [0, 1.47, 0.02], color: spec.shirtDark, bone: boneIndex('chest') });

  const head = boneIndex('head');
  b.frustum({ radiusBottom: 0.055, radiusTop: 0.05, height: 0.09, segments: 6, capBottom: false, capTop: false }, {
    at: [0, 1.45, 0],
    color: spec.skin,
    bone: head,
  });
  b.blob({ radius: 0.13, stretch: [0.95, 1.05, 1], subdivide: true }, { at: [0, 1.62, 0], color: spec.skin, bone: head });
  b.blob({ radius: 0.137, stretch: [1, 0.62, 1.02], subdivide: true }, { at: [0, 1.69, 0.012], color: spec.hair, bone: head });
  b.box([0.035, 0.045, 0.02], { at: [0.05, 1.635, -0.122], color: spec.eye, bone: head });
  b.box([0.035, 0.045, 0.02], { at: [-0.05, 1.635, -0.122], color: spec.eye, bone: head });

  for (const side of ['L', 'R'] as const) {
    const x = side === 'R' ? 0.22 : -0.22;
    limb(`upperArm_${side}`, UPPER_ARM, 0.062, 0.055, spec.shirt);
    limb(`lowerArm_${side}`, 0.22, 0.052, 0.045, spec.shirt);
    b.box([0.075, 0.09, 0.085], { at: [x, 0.875, 0], color: spec.skin, bone: boneIndex(`lowerArm_${side}`) });

    const legX = side === 'R' ? 0.1 : -0.1;
    limb(`upperLeg_${side}`, THIGH, 0.082, 0.07, spec.pants);
    limb(`lowerLeg_${side}`, 0.42, 0.066, 0.056, spec.pants);
    const shin = boneIndex(`lowerLeg_${side}`);
    b.box([0.12, 0.08, 0.25], { at: [legX, 0.05, -0.04], color: spec.shoe, bone: shin });
    b.box([0.125, 0.025, 0.255], { at: [legX, 0.0125, -0.04], color: spec.sole, bone: shin });
  }

  spec.extras?.(b);
  return b;
}

export interface Pose {
  /** Local Euler rotations (radians, XYZ). Missing bones stay at rest. */
  rot: Partial<Record<BoneName, Vec3>>;
  /** Offset added to the hips rest position. */
  hips?: Vec3;
}

export interface Clip {
  name: string;
  duration: number;
  /** `phase` in [0, 1); clips must be periodic so the last key equals the first (seamless loop). */
  pose: (phase: number) => Pose;
}

const TAU = Math.PI * 2;
const rx = (angle: number): Vec3 => [angle, 0, 0];

export const IDLE: Clip = {
  name: 'anim_Idle',
  duration: ANIM.idleCycle,
  pose: (p) => {
    const s = Math.sin(TAU * p);
    return {
      rot: {
        chest: rx(deg(1.5 * s)),
        head: [deg(-1 * s), deg(4 * Math.sin(TAU * p + 1)), 0],
        upperArm_L: [0, 0, deg(-5 - s)],
        upperArm_R: [0, 0, deg(5 + s)],
        lowerArm_L: rx(deg(8)),
        lowerArm_R: rx(deg(8)),
      },
      hips: [0, 0.004 * s, 0],
    };
  },
};

export const WALK: Clip = {
  name: 'anim_Walk',
  duration: ANIM.walkCycle,
  pose: (p) => {
    const a = TAU * p;
    const s = Math.sin(a);
    const c = Math.cos(a);
    return {
      rot: {
        upperLeg_R: rx(deg(28 * s)),
        upperLeg_L: rx(deg(-28 * s)),
        lowerLeg_R: rx(deg(-5 - 40 * Math.max(0, c))),
        lowerLeg_L: rx(deg(-5 - 40 * Math.max(0, -c))),
        upperArm_R: [deg(-22 * s), 0, deg(4)],
        upperArm_L: [deg(22 * s), 0, deg(-4)],
        lowerArm_R: rx(deg(18)),
        lowerArm_L: rx(deg(18)),
        spine: [deg(-3), deg(-5 * s), 0],
      },
      hips: [0, 0.02 * Math.cos(2 * a) - 0.02, 0],
    };
  },
};

export const RUN: Clip = {
  name: 'anim_Run',
  duration: ANIM.runCycle,
  pose: (p) => {
    const a = TAU * p;
    const s = Math.sin(a);
    const c = Math.cos(a);
    return {
      rot: {
        upperLeg_R: rx(deg(45 * s)),
        upperLeg_L: rx(deg(-45 * s)),
        lowerLeg_R: rx(deg(-25 - 60 * Math.max(0, c))),
        lowerLeg_L: rx(deg(-25 - 60 * Math.max(0, -c))),
        upperArm_R: [deg(-45 * s), 0, deg(6)],
        upperArm_L: [deg(45 * s), 0, deg(-6)],
        lowerArm_R: rx(deg(75)),
        lowerArm_L: rx(deg(75)),
        spine: [deg(-12), deg(-8 * s), 0],
        head: rx(deg(8)),
      },
      hips: [0, 0.04 * Math.cos(2 * a) - 0.05, 0],
    };
  },
};

/** Riding stance on the deck: legs solved with IK so both soles stay on SKATE.deckTopY. */
export const SKATE_RIDE: Clip = {
  name: 'anim_Skate',
  duration: ANIM.skateCycle,
  pose: (p) => {
    const a = TAU * p;
    const s = Math.sin(a);
    const hips: Vec3 = [0.02 * s, 0.05 + 0.01 * Math.sin(2 * a), 0];
    const hipY = boneRest('upperLeg_R')[1] + hips[1];
    const right = solveTwoBone({ y: hipY, z: hips[2] }, { y: SKATE.deckTopY, z: -0.17 }, THIGH, SHIN_TO_SOLE, true);
    const left = solveTwoBone({ y: hipY, z: hips[2] }, { y: SKATE.deckTopY, z: 0.15 }, THIGH, SHIN_TO_SOLE, true);
    return {
      rot: {
        upperLeg_R: rx(right.upper),
        lowerLeg_R: rx(right.lower),
        upperLeg_L: rx(left.upper),
        lowerLeg_L: rx(left.lower),
        spine: [deg(-10), deg(-8), deg(-3 * s)],
        head: [deg(8), deg(8), 0],
        upperArm_R: [deg(10 * s), 0, deg(25 + 5 * s)],
        upperArm_L: [deg(-10 * s), 0, deg(-25 + 5 * s)],
        lowerArm_R: rx(deg(20)),
        lowerArm_L: rx(deg(20)),
      },
      hips,
    };
  },
};

/** Seated pedalling pose; one clip loop = one crank turn. Feet and hands are IK'd onto pedals/grips. */
export const BIKE_RIDE: Clip = {
  name: 'anim_Bike',
  duration: ANIM.bikeCycle,
  pose: (p) => {
    const hips: Vec3 = [0, BIKE.saddleTopY + 0.095 - boneRest('hips')[1], BIKE.saddleZ];
    const lean = deg(-35);
    const spineLean = lean * 0.6;
    const hipY = boneRest('upperLeg_R')[1] + hips[1];

    const leg = (crankAngle: number) => {
      const pedalY = BIKE.crankY + BIKE.crankLength * Math.sin(crankAngle);
      const pedalZ = BIKE.crankZ - BIKE.crankLength * Math.cos(crankAngle);
      return solveTwoBone({ y: hipY, z: hips[2] }, { y: pedalY + 0.02, z: pedalZ }, THIGH, SHIN_TO_SOLE, true);
    };
    const crank = -TAU * p;
    const right = leg(crank);
    const left = leg(crank + Math.PI);

    const spineY = boneRest('spine')[1] + hips[1];
    const spineZ = hips[2];
    const chestLen = boneRest('chest')[1] - boneRest('spine')[1];
    const shoulderLen = boneRest('upperArm_R')[1] - boneRest('chest')[1];
    const chestY = spineY + chestLen * Math.cos(spineLean);
    const chestZ = spineZ + chestLen * Math.sin(spineLean);
    const shoulderY = chestY + shoulderLen * Math.cos(lean);
    const shoulderZ = chestZ + shoulderLen * Math.sin(lean);
    const dy = BIKE.gripY - shoulderY;
    const dz = BIKE.gripZ - shoulderZ;
    const local = { y: dy * Math.cos(lean) + dz * Math.sin(lean), z: -dy * Math.sin(lean) + dz * Math.cos(lean) };
    const arm = solveTwoBone({ y: 0, z: 0 }, local, UPPER_ARM, FOREARM_TO_HAND, false);

    return {
      rot: {
        spine: rx(spineLean),
        chest: rx(lean - spineLean),
        head: rx(-lean * 0.8),
        upperLeg_R: rx(right.upper),
        lowerLeg_R: rx(right.lower),
        upperLeg_L: rx(left.upper),
        lowerLeg_L: rx(left.lower),
        upperArm_R: rx(arm.upper),
        lowerArm_R: rx(arm.lower),
        upperArm_L: rx(arm.upper),
        lowerArm_L: rx(arm.lower),
      },
      hips,
    };
  },
};

export const TALK: Clip = {
  name: 'anim_Talk',
  duration: ANIM.talkCycle,
  pose: (p) => {
    const a = TAU * p;
    const s = Math.sin(a);
    return {
      rot: {
        upperArm_R: [deg(45 + 8 * s), 0, deg(12)],
        lowerArm_R: rx(deg(55 + 15 * Math.sin(2 * a))),
        upperArm_L: [deg(5), 0, deg(-6)],
        lowerArm_L: rx(deg(10)),
        head: [deg(4 * Math.sin(2 * a)), deg(8 * s), 0],
        chest: rx(deg(2 * s)),
      },
      hips: [0, 0.004 * s, 0],
    };
  },
};

const ANIMATION_FPS = 30;

/** Builds a skinned GLB document: joints, inverse bind matrices, mesh, and sampled looping clips. */
export function buildCharacterDocument(id: string, body: BodySpec, clips: Clip[]): Document {
  const { doc, material } = createBaseDocument();
  const mesh = addMesh(doc, id, [{ builder: buildBody(body), material }], true);

  const joints: Node[] = BONES.map((bone) => {
    const parent = BONES[bone.parent];
    const local: Vec3 = parent
      ? [bone.rest[0] - parent.rest[0], bone.rest[1] - parent.rest[1], bone.rest[2] - parent.rest[2]]
      : bone.rest;
    return doc.createNode(`bone_${bone.name}`).setTranslation(local);
  });
  BONES.forEach((bone, i) => {
    const node = joints[i];
    const parent = joints[bone.parent];
    if (node && parent) parent.addChild(node);
  });

  const inverseBind = new Float32Array(BONES.length * 16);
  BONES.forEach((bone, i) => {
    inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -bone.rest[0], -bone.rest[1], -bone.rest[2], 1], i * 16);
  });
  const rootJoint = joints[0];
  if (!rootJoint) throw new Error('Rig has no root');
  const skin = doc.createSkin(`skin_${id}`).setSkeleton(rootJoint).setInverseBindMatrices(createAccessor(doc, 'MAT4', inverseBind));
  joints.forEach((joint) => skin.addJoint(joint));

  // Skinned mesh node and skeleton sit at the scene root (glTF: parent transforms don't affect skinned meshes).
  const meshNode = doc.createNode(id).setMesh(mesh).setSkin(skin);
  const scene = doc.createScene(id).addChild(rootJoint).addChild(meshNode);
  doc.getRoot().setDefaultScene(scene);

  const hipsIndex = boneIndex('hips');
  const hipsRest = boneRest('hips');
  for (const clip of clips) {
    const frames = Math.max(2, Math.round(clip.duration * ANIMATION_FPS));
    const times = new Float32Array(frames + 1);
    const rotations = BONES.map(() => new Float32Array((frames + 1) * 4));
    const hipsTranslation = new Float32Array((frames + 1) * 3);

    for (let frame = 0; frame <= frames; frame++) {
      times[frame] = (frame / frames) * clip.duration;
      const pose = clip.pose(frame === frames ? 0 : frame / frames);
      BONES.forEach((bone, i) => rotations[i]?.set(quatFromEuler(pose.rot[bone.name] ?? [0, 0, 0]), frame * 4));
      const offset = pose.hips ?? [0, 0, 0];
      hipsTranslation.set([hipsRest[0] + offset[0], hipsRest[1] + offset[1], hipsRest[2] + offset[2]], frame * 3);
    }

    const animation = doc.createAnimation(clip.name);
    const input = createAccessor(doc, 'SCALAR', times);
    const addTrack = (node: Node, path: 'rotation' | 'translation', values: Float32Array) => {
      const sampler = doc
        .createAnimationSampler()
        .setInput(input)
        .setOutput(createAccessor(doc, path === 'rotation' ? 'VEC4' : 'VEC3', values))
        .setInterpolation('LINEAR');
      const channel = doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler);
      animation.addSampler(sampler).addChannel(channel);
    };

    BONES.forEach((_, i) => {
      const node = joints[i];
      const values = rotations[i];
      if (i > 0 && node && values) addTrack(node, 'rotation', values);
    });
    const hipsNode = joints[hipsIndex];
    if (hipsNode) addTrack(hipsNode, 'translation', hipsTranslation);
  }

  return doc;
}