import { askNearby, jump, openBus, toggleSeat, toggleVehicle } from '../game/actions';
import { VEHICLE_LABELS } from '../game/vehicles';
import { useGameStore } from '../state/gameStore';

/**
 * MOBA-style action cluster (bottom right): a large primary button (Lompat) with smaller skill
 * buttons arcing around it. Context buttons only appear when something usable is in range.
 */
export function ActionButtons() {
  const riding = useGameStore((state) => state.riding);
  const mode = useGameStore((state) => state.mode);
  const nearbyNpc = useGameStore((state) => state.nearby.npcId);
  const nearbyBus = useGameStore((state) => state.nearby.busStopId);
  const nearbyVehicle = useGameStore((state) => state.vehicles.find((item) => item.id === state.nearby.vehicleId) ?? null);
  const nearbySeat = useGameStore((state) => state.nearby.seatId);
  const seated = useGameStore((state) => state.seated);
  const canJump = mode !== 'car';
  // Naik/Turun kendaraan disembunyikan selama duduk.
  const useLabel = seated ? null : riding ? `Turun dari ${VEHICLE_LABELS[riding.kind]}` : nearbyVehicle ? `Naik ${VEHICLE_LABELS[nearbyVehicle.kind]}` : null;

  return (
    <div className="action-cluster" role="group" aria-label="Aksi">
      <button
        type="button"
        className="action-button action-primary"
        aria-label="Lompat"
        disabled={!canJump}
        onPointerDown={(event) => {
          event.preventDefault();
          jump();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') jump();
        }}
      >
        <span className="action-icon" aria-hidden="true">
          ⤒
        </span>
        <span className="action-text">Lompat</span>
      </button>

      {useLabel && (
        <button type="button" className="action-button action-skill action-slot-1" aria-label={useLabel} onClick={toggleVehicle}>
          <span className="action-icon" aria-hidden="true">
            {riding ? '⇩' : '⚲'}
          </span>
          <span className="action-text">{riding ? 'Turun' : 'Naik'}</span>
        </button>
      )}

      {nearbyNpc && (
        <button type="button" className="action-button action-skill action-slot-2 action-ask" aria-label="Tanya NPC" onClick={askNearby}>
          <span className="action-icon" aria-hidden="true">
            ?
          </span>
          <span className="action-text">Tanya</span>
        </button>
      )}

      {(seated || nearbySeat) && (
        <button
          type="button"
          className="action-button action-skill action-sit"
          // Slot ke-4 di kiri slot Tanya, tidak menimpa slot 1-3 (70 px dari .action-skill, >= 48 px).
          // ponytail: inline karena styles.css di luar cakupan task ini; pindahkan ke .action-slot-4 nanti.
          style={{ right: 170, bottom: 82, borderColor: '#9be37a' }}
          aria-label={seated ? 'Berdiri dari bangku' : 'Duduk di bangku'}
          onClick={toggleSeat}
        >
          <span className="action-icon" aria-hidden="true">
            {seated ? '⇧' : '⇲'}
          </span>
          <span className="action-text">{seated ? 'Berdiri' : 'Duduk'}</span>
        </button>
      )}

      {nearbyBus && !riding && (
        <button type="button" className="action-button action-skill action-slot-3 action-bus" aria-label="Naik bus" onClick={openBus}>
          <span className="action-icon" aria-hidden="true">
            ⛟
          </span>
          <span className="action-text">Bus</span>
        </button>
      )}
    </div>
  );
}