import { characterAssets } from './defs/characters';
import { creatureAssets } from './defs/creatures';
import { propAssets } from './defs/props';
import { streetPropAssets } from './defs/street';
import { trafficVehicleAssets } from './defs/traffic';
import { vehicleAssets } from './defs/vehicles';
import type { AssetDef } from './defs/types';

export const ASSETS: AssetDef[] = [...characterAssets, ...vehicleAssets, ...trafficVehicleAssets, ...propAssets, ...streetPropAssets, ...creatureAssets];