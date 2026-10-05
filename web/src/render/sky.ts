import { Color } from 'three';
export interface SkyPalette { horizon: Color; zenith: Color; fog: Color; stars: number; clouds: number; }
const lerpColor=(a:Color,b:Color,t:number)=>a.clone().lerp(b,t);
export function skyPalette(daylight:number,dusk:number):SkyPalette {
  const nightH=new Color('#536a9b'), nightZ=new Color('#171c3a'), dayH=new Color('#c4d9e8'), dayZ=new Color('#78b6e3');
  const h=lerpColor(nightH,dayH,daylight); const z=lerpColor(nightZ,dayZ,daylight);
  if(dusk>0){ h.lerp(new Color('#e99a71'),dusk*.65); z.lerp(new Color('#554b88'),dusk*.35); }
  return { horizon:h, zenith:z, fog:h.clone(), stars:Math.max(0,1-daylight)*.95, clouds:.15+.7*daylight };
}
