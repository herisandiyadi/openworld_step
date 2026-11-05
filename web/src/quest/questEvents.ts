export type RideDestination = string | { x: number; z: number; radius: number };

export type QuestEvent =
  | { type: 'talk'; npc: string }
  | { type: 'reach'; x: number; z: number }
  | { type: 'ride'; vehicle: string; destination?: RideDestination; durationSeconds?: number }
  | { type: 'collect'; item: string; quantity: number }
  | { type: 'visit_district'; district: string }
  | { type: 'time'; hour: number }
  | { type: 'catch'; species?: string; weight?: number; quantity: number }
  | { type: 'dispose'; quantity: number; item?: string };

export const talked = (npc: string): QuestEvent => ({ type: 'talk', npc });
export const reached = (x: number, z: number): QuestEvent => ({ type: 'reach', x, z });
export const ridden = (vehicle: string, destination?: RideDestination, durationSeconds?: number): QuestEvent => ({
  type: 'ride',
  vehicle,
  ...(destination === undefined ? {} : { destination }),
  ...(durationSeconds === undefined ? {} : { durationSeconds }),
});
export const collected = (item: string, quantity = 1): QuestEvent => ({ type: 'collect', item, quantity });
export const visitedDistrict = (district: string): QuestEvent => ({ type: 'visit_district', district });
export const timeReached = (hour: number): QuestEvent => ({ type: 'time', hour });
export const caught = (species?: string, weight?: number, quantity = 1): QuestEvent => ({
  type: 'catch',
  ...(species === undefined ? {} : { species }),
  ...(weight === undefined ? {} : { weight }),
  quantity,
});
export const disposed = (quantity = 1, item?: string): QuestEvent => ({
  type: 'dispose',
  quantity,
  ...(item === undefined ? {} : { item }),
});
