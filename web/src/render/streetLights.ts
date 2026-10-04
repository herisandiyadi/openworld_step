export interface LampPosition { x:number; y:number; z:number; }
export function streetLampBudget(tier: 'low'|'medium'|'high'): number { return tier === 'low' ? 0 : tier === 'medium' ? 3 : 6; }

export function nearestLamps<T extends LampPosition>(lamps:readonly T[],x:number,z:number,maxCount:number,maxDistance:number):T[] { if(maxCount<=0)return []; const r2=maxDistance*maxDistance; return lamps.map((lamp,index)=>({lamp,index,d:(lamp.x-x)**2+(lamp.z-z)**2})).filter(v=>v.d<=r2).sort((a,b)=>a.d-b.d||a.index-b.index).slice(0,maxCount).map(v=>v.lamp); }
