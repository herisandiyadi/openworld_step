export const WINDOW_LIT_RATIO = 0.42;
export function windowCellLit(x:number,y:number):boolean { const n=Math.sin(x*12.9898+y*78.233)*43758.5453; return n-Math.floor(n)<WINDOW_LIT_RATIO; }
