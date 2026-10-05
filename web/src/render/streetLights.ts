export interface LampPosition { x:number; y:number; z:number; }
export function streetLampBudget(tier: 'low'|'medium'|'high'): number { return tier === 'low' ? 1 : tier === 'medium' ? 3 : 6; }

/** Extract instance origins from a column-major Matrix4 array without touching Three.js. */
export function lampPositionsFromMatrices(matrices: ArrayLike<number>): LampPosition[] {
  const positions: LampPosition[] = [];
  for (let offset = 0; offset + 14 < matrices.length; offset += 16) {
    const rawX = matrices[offset + 12] ?? 0;
    const rawY = matrices[offset + 13] ?? 0;
    const rawZ = matrices[offset + 14] ?? 0;
    positions.push({
      x: Math.round(rawX * 10000) / 10000,
      y: Math.round(rawY * 10000) / 10000,
      z: Math.round(rawZ * 10000) / 10000,
    });
  }
  return positions;
}

export function nearestLamps<T extends LampPosition>(lamps:readonly T[],x:number,z:number,maxCount:number,maxDistance:number):T[] { if(maxCount<=0)return []; const r2=maxDistance*maxDistance; return lamps.map((lamp,index)=>({lamp,index,d:(lamp.x-x)**2+(lamp.z-z)**2})).filter(v=>v.d<=r2).sort((a,b)=>a.d-b.d||a.index-b.index).slice(0,maxCount).map(v=>v.lamp); }
