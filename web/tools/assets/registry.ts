import { characterAssets } from './defs/characters';
import { propAssets } from './defs/props';
import { vehicleAssets } from './defs/vehicles';
import type { AssetDef } from './defs/types';

export const ASSETS: AssetDef[] = [...characterAssets, ...vehicleAssets, ...propAssets];