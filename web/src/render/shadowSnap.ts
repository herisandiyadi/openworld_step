export type Vec3 = readonly [number,number,number];
export function texelSnapOffset(position:Vec3,target:Vec3,texel:number):[number,number,number]{
  const dx=target[0]-position[0], dy=target[1]-position[1], dz=target[2]-position[2];
  const length=Math.hypot(dx,dy,dz); const ux=dx/length,uy=dy/length,uz=dz/length;
  // Build a deterministic horizontal basis; the offset is perpendicular to the light direction.
  let sx=-uz, sy=0, sz=ux; const sl=Math.hypot(sx,sz); sx/=sl; sz/=sl;
  const bx=uy*sz, by=uz*sx-ux*sz, bz=-uy*sx;
  const a=Math.round((position[0]*sx+position[1]*sy+position[2]*sz)/texel)*texel-(position[0]*sx+position[1]*sy+position[2]*sz);
  const b=Math.round((position[0]*bx+position[1]*by+position[2]*bz)/texel)*texel-(position[0]*bx+position[1]*by+position[2]*bz);
  return [sx*a+bx*b, sy*a+by*b, sz*a+bz*b];
}
