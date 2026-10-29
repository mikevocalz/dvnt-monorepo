// Browser Canvas2D stands in for native Skia only; production crop/clip/encode code runs unchanged.
module.exports = `
export const ClipOp={Intersect:1}, ImageFormat={PNG:4};
const dispose=()=>{window.fixture.disposals=(window.fixture.disposals||0)+1};
export const Skia={
 Data:{fromURI:async source=>{
  window.fixture.iconLoads=(window.fixture.iconLoads||[]).concat(source);
  if(source.includes('slow'))await new Promise(resolve=>setTimeout(resolve,150));
  if(source.includes('broken'))throw new Error('Image unavailable');
  return {source,dispose};
 }},
 Image:{MakeImageFromEncoded:data=>{
  const element=document.createElement('canvas');element.width=88;element.height=88;
  const c=element.getContext('2d');c.fillStyle='#379ED8';c.fillRect(0,0,88,88);
  return {element,width:()=>88,height:()=>88,dispose};
 }},
 Color:value=>value,
 XYWHRect:(x,y,width,height)=>({x,y,width,height}),
 RRectXY:(rect,rx,ry)=>({rect,rx,ry}), Paint:()=>({dispose}),
 Surface:{Make:(width,height)=>{
  const element=document.createElement('canvas');element.width=width;element.height=height;
  const context=element.getContext('2d');
  return {dispose,flush:()=>{},getCanvas:()=>({
   clear:()=>context.clearRect(0,0,width,height),
   clipRRect:({rect,rx,ry},op,antialias)=>{window.fixture.iconClips=(window.fixture.iconClips||[]).concat({width,height,rx,ry,op,antialias});context.beginPath();context.roundRect(rect.x,rect.y,rect.width,rect.height,rx);context.clip()},
   drawImageRect:(image,src,dest)=>context.drawImage(image.element,src.x,src.y,src.width,src.height,dest.x,dest.y,dest.width,dest.height),
  }),makeImageSnapshot:()=>({dispose,encodeToBase64:()=>element.toDataURL('image/png').split(',')[1]})};
 }}
};
`;
