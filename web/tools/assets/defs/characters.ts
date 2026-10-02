import { boneIndex, buildCharacterDocument, buildCustomCharacter, BIKE_RIDE, IDLE, RUN, SKATE_RIDE, TALK, WALK } from './humanoid';
import { PALETTE } from '../lib/palette';
import type { AssetDef } from './types';

const CHARACTER_TAGS = ['character', 'city'];

export const characterAssets: AssetDef[] = [
  {
    id: 'char_hero',
    category: 'hero',
    tags: [...CHARACTER_TAGS, 'player'],
    collider: { type: 'capsule', radius: 0.3, height: 1.75, center: [0, 0.875, 0] },
    requiredAnimations: ['anim_Idle', 'anim_Walk', 'anim_Run', 'anim_Skate', 'anim_Bike'],
    previews: [
      { clip: 'anim_Walk', phase: 0.25 },
      { clip: 'anim_Run', phase: 0.25 },
      { clip: 'anim_Skate', phase: 0, with: 'veh_skateboard' },
      { clip: 'anim_Bike', phase: 0, with: 'veh_bicycle' },
    ],
    build: () =>
      buildCharacterDocument(
        'char_hero',
        {
          skin: PALETTE.skin,
          hair: PALETTE.hair,
          eye: PALETTE.eye,
          shirt: PALETTE.hoodie,
          shirtDark: PALETTE.hoodieDark,
          pants: PALETTE.jeans,
          shoe: PALETTE.shoe,
          sole: PALETTE.sole,
          extras: (b) => {
            const chest = boneIndex('chest');
            b.box([0.3, 0.34, 0.13], { at: [0, 1.3, 0.18], color: PALETTE.backpack, bone: chest });
            b.box([0.24, 0.1, 0.03], { at: [0, 1.22, 0.255], color: PALETTE.hoodieDark, bone: chest });
          },
        },
        [IDLE, WALK, RUN, SKATE_RIDE, BIKE_RIDE],
      ),
  },
  {
    id: 'npc_vendor',
    category: 'npc',
    tags: [...CHARACTER_TAGS, 'npc', 'vendor', 'downtown'],
    collider: { type: 'capsule', radius: 0.3, height: 1.8, center: [0, 0.9, 0] },
    requiredAnimations: ['anim_Idle', 'anim_Talk', 'anim_Walk'],
    previews: [
      { clip: 'anim_Talk', phase: 0.25 },
      { clip: 'anim_Walk', phase: 0.25 },
    ],
    build: () =>
      buildCharacterDocument(
        'npc_vendor',
        {
          skin: PALETTE.skinTan,
          hair: PALETTE.hair,
          eye: PALETTE.eye,
          shirt: PALETTE.white,
          shirtDark: PALETTE.white,
          pants: PALETTE.pantsDark,
          shoe: PALETTE.pantsDark,
          sole: PALETTE.sole,
          extras: (b) => {
            const head = boneIndex('head');
            const hips = boneIndex('hips');
            const spine = boneIndex('spine');
            b.box([0.34, 0.34, 0.03], { at: [0, 1.12, -0.115], color: PALETTE.apron, bone: spine });
            b.box([0.3, 0.22, 0.03], { at: [0, 0.86, -0.115], color: PALETTE.apron, bone: hips });
            b.frustum({ radiusBottom: 0.142, radiusTop: 0.12, height: 0.08, segments: 8 }, { at: [0, 1.7, 0.01], color: PALETTE.cap, bone: head });
            b.box([0.2, 0.02, 0.12], { at: [0, 1.71, -0.16], color: PALETTE.cap, bone: head });
            b.box([0.1, 0.025, 0.02], { at: [0, 1.57, -0.128], color: PALETTE.hair, bone: head });
          },
        },
        [IDLE, TALK, WALK],
      ),
  },
  // Dua GLB kustomisasi (NEXT_FEATURES 9.3). Node varian: hair, shirt_0..2, pants_0..2, face_0..2.
  ...(['m', 'f'] as const).map((gender): AssetDef => ({
    id: `char_hero_${gender}`,
    category: 'hero',
    tags: [...CHARACTER_TAGS, 'player', 'custom'],
    collider: { type: 'capsule', radius: 0.3, height: 1.75, center: [0, 0.875, 0] },
    requiredAnimations: ['anim_Idle', 'anim_Walk', 'anim_Run', 'anim_Skate', 'anim_Bike', 'anim_Talk'],
    requiredNodes: ['hair', 'shirt_0', 'shirt_1', 'shirt_2', 'pants_0', 'pants_1', 'pants_2', 'face_0', 'face_1', 'face_2'],
    previews: [
      { clip: 'anim_Walk', phase: 0.25 },
      { clip: 'anim_Run', phase: 0.25 },
      { clip: 'anim_Skate', phase: 0, with: 'veh_skateboard' },
      { clip: 'anim_Bike', phase: 0, with: 'veh_bicycle' },
    ],
    build: () =>
      buildCustomCharacter(
        `char_hero_${gender}`,
        gender,
        { skin: PALETTE.skin, eye: PALETTE.eye, shoe: PALETTE.shoe, sole: PALETTE.sole },
        { hair: PALETTE.hair, shirt: PALETTE.hoodie, pants: PALETTE.jeans },
        [IDLE, WALK, RUN, SKATE_RIDE, BIKE_RIDE, TALK],
      ),
  })),
];
