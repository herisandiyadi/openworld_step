import { askNearby, jump, leaveBus, openBus, toggleSeat, toggleVehicle } from '../game/actions';
import { VEHICLE_LABELS } from '../game/vehicles';
import { useGameStore } from '../state/gameStore';
import { openNearbyShop, openNearbyStall, disposeNearbyTrash } from '../game/economyActions';
import { startFishing, cancelFishing } from '../game/fishingActions';

/**
 * Context action cluster. During fishing the movement/vehicle/seat actions are
 * hidden; FishingHud owns the pull/cancel controls instead.
 */
export function ActionButtons() {
  const riding = useGameStore((state) => state.riding);
  const mode = useGameStore((state) => state.mode);
  const nearby = useGameStore((state) => state.nearby);
  const nearbyVehicle = useGameStore((state) => state.vehicles.find((item) => item.id === state.nearby.vehicleId) ?? null);
  const seated = useGameStore((state) => state.seated);
  const onBus = useGameStore((state) => state.busRide !== null);
  const fishing = useGameStore((state) => state.fishing);
  const canJump = mode !== 'car' && !onBus && !fishing;
  const useLabel = seated || onBus || fishing ? null : riding ? `Turun dari ${VEHICLE_LABELS[riding.kind]}` : nearbyVehicle ? `Naik ${VEHICLE_LABELS[nearbyVehicle.kind]}` : null;

  if (fishing) {
    return (
      <div className="action-cluster" role="group" aria-label="Aksi memancing">
        <button type="button" className="action-button action-skill action-fishing-cancel" aria-label="Batal memancing" onClick={cancelFishing}>
          <span className="action-icon" aria-hidden="true">✕</span>
          <span className="action-text">Batal</span>
        </button>
      </div>
    );
  }

  return (
    <div className="action-cluster" role="group" aria-label="Aksi">
      <button
        type="button"
        className="action-button action-primary"
        aria-label="Lompat"
        disabled={!canJump}
        onPointerDown={(event) => { event.preventDefault(); jump(); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') jump(); }}
      >
        <span className="action-icon" aria-hidden="true">⤒</span>
        <span className="action-text">Lompat</span>
      </button>

      {useLabel && (
        <button type="button" className="action-button action-skill action-slot-1" aria-label={useLabel} onClick={toggleVehicle}>
          <span className="action-icon" aria-hidden="true">{riding ? '⇩' : '⚲'}</span>
          <span className="action-text">{riding ? 'Turun' : 'Naik'}</span>
        </button>
      )}

      {onBus && (
        <button type="button" className="action-button action-skill action-slot-1 action-bus" aria-label="Turun dari bus" onClick={leaveBus}>
          <span className="action-icon" aria-hidden="true">⇩</span><span className="action-text">Turun</span>
        </button>
      )}

      {!onBus && nearby.npcId && (
        <button type="button" className="action-button action-skill action-slot-2 action-ask" aria-label="Tanya warga" onClick={askNearby}>
          <span className="action-icon" aria-hidden="true">?</span><span className="action-text">Tanya</span>
        </button>
      )}

      {!onBus && (seated || nearby.seatId) && (
        <button type="button" className="action-button action-skill action-slot-4 action-sit" aria-label={seated ? 'Berdiri dari bangku' : 'Duduk di bangku'} onClick={toggleSeat}>
          <span className="action-icon" aria-hidden="true">{seated ? '⇧' : '⇲'}</span><span className="action-text">{seated ? 'Berdiri' : 'Duduk'}</span>
        </button>
      )}

      {nearby.busStopId && !riding && !onBus && (
        <button type="button" className="action-button action-skill action-slot-3 action-bus" aria-label="Naik bus" onClick={openBus}>
          <span className="action-icon" aria-hidden="true">⛟</span><span className="action-text">Bus</span>
        </button>
      )}

      {nearby.shopId && !onBus && <button type="button" className="action-button action-skill action-slot-2" aria-label="Buka toko" onClick={openNearbyShop}>🛒 <span className="action-text">Toko</span></button>}
      {nearby.fishingSpotId && !onBus && <button type="button" className="action-button action-skill action-slot-3" aria-label="Mulai memancing" onClick={() => startFishing()}>🎣 <span className="action-text">Pancing</span></button>}
      {nearby.trashBinId && !onBus && <button type="button" className="action-button action-skill action-slot-4" aria-label="Buang sampah" onClick={disposeNearbyTrash}>🗑️ <span className="action-text">Buang</span></button>}
      {nearby.fishStallId && !onBus && <button type="button" className="action-button action-skill action-slot-1" aria-label="Buka lapak ikan" onClick={openNearbyStall}>🐟 <span className="action-text">Jual ikan</span></button>}
    </div>
  );
}
