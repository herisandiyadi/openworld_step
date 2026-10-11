import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { joystickInput } from '../game/runtime';
import { filteredRawInput } from '../game/inputLock';
import { useGameStore } from '../state/gameStore';

const RADIUS = 56;

/**
 * Virtual joystick bound to a single pointer (pointer capture), so it can be held while other
 * fingers tap the world or HUD buttons.
 */
export function Joystick() {
  const baseRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const update = (event: ReactPointerEvent<HTMLDivElement>) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    let dx = event.clientX - (rect.left + rect.width / 2);
    let dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy);
    if (distance > RADIUS) {
      dx = (dx / distance) * RADIUS;
      dy = (dy / distance) * RADIUS;
    }
    // Fishing hard-locks movement: the knob still moves visually, locomotion stays zeroed.
    const fishing = useGameStore.getState().fishing !== null;
    const gate = filteredRawInput(fishing, { x: dx / RADIUS, z: dy / RADIUS });
    joystickInput.x = gate.x;
    joystickInput.z = gate.z;
    setKnob({ x: dx, y: dy });
  };

  const release = () => {
    pointerRef.current = null;
    joystickInput.x = 0;
    joystickInput.z = 0;
    setKnob({ x: 0, y: 0 });
  };

  return (
    <div
      ref={baseRef}
      className="joystick"
      role="presentation"
      onPointerDown={(event) => {
        if (pointerRef.current !== null) return;
        pointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
      }}
      onPointerMove={(event) => {
        if (event.pointerId === pointerRef.current) update(event);
      }}
      onPointerUp={(event) => {
        if (event.pointerId === pointerRef.current) release();
      }}
      onPointerCancel={(event) => {
        if (event.pointerId === pointerRef.current) release();
      }}
      onLostPointerCapture={(event) => {
        if (event.pointerId === pointerRef.current) release();
      }}
    >
      <div className="joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}