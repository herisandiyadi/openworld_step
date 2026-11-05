import { AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { ClipPlayer } from './character';

function action(mixer: AnimationMixer, name: string) {
  return mixer.clipAction(new AnimationClip(name, 1, []));
}

describe('ClipPlayer one-shot transitions', () => {
  it('fades looping locomotion out and plays the one-shot with LoopOnce', () => {
    const mixer = new AnimationMixer(new Object3D());
    const player = new ClipPlayer();
    const locomotion = action(mixer, 'anim_Run');
    const cast = action(mixer, 'anim_Cast');

    player.play(locomotion, 0);
    player.playOnce(cast, 0.2);

    expect(locomotion.getEffectiveWeight()).toBe(1);
    mixer.update(0.2);
    expect(locomotion.getEffectiveWeight()).toBeCloseTo(0);
    expect(cast.loop).toBe(LoopOnce);
    expect(cast.clampWhenFinished).toBe(true);
    expect(cast.isRunning()).toBe(true);
  });

  it('transitions from a finished one-shot to the requested looping hold action', () => {
    const mixer = new AnimationMixer(new Object3D());
    const player = new ClipPlayer();
    const cast = action(mixer, 'anim_Cast');
    const hold = action(mixer, 'anim_FishIdle');

    player.playOnce(cast, 0);
    mixer.update(1);
    player.play(hold, 0.15);

    expect(hold.loop).toBe(LoopRepeat);
    expect(hold.isRunning()).toBe(true);
  });
});
