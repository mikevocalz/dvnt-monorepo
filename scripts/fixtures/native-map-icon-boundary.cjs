// Browser Canvas2D stands in for native Skia only; production crop/clip/encode code runs unchanged.
module.exports = `
export const ClipOp={Intersect:1}, ImageFormat={PNG:4};
export const matchFont=()=>({measureText:text=>({x:0,y:-10,width:text.length*8,height:14}),dispose});
const dispose=()=>{window.fixture.disposals=(window.fixture.disposals||0)+1};
export const Skia={
 FontMgr:{System:()=>({dispose})},
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
 RRectXY:(rect,rx,ry)=>({rect,rx,ry}), Paint:()=>({dispose,color:null,setColor(color){this.color=color}}),
 Surface:{Make:(width,height)=>{
  if(window.fixture.failRaster)return null;
  const element=document.createElement('canvas');element.width=width;element.height=height;
  const context=element.getContext('2d');
  return {dispose,flush:()=>{},getCanvas:()=>({
   clear:()=>context.clearRect(0,0,width,height),
   clipRRect:({rect,rx,ry},op,antialias)=>{window.fixture.iconClips=(window.fixture.iconClips||[]).concat({width,height,rx,ry,op,antialias});context.beginPath();context.roundRect(rect.x,rect.y,rect.width,rect.height,rx);context.clip()},
   drawPaint:paint=>{context.fillStyle=paint.color;context.fillRect(0,0,width,height)},
   drawText:(text,x,y,paint)=>{context.font='bold 14px sans-serif';context.fillStyle=paint.color;context.fillText(text,x,y)},
   drawImageRect:(image,src,dest)=>{window.fixture.iconDraws=(window.fixture.iconDraws||0)+1;context.drawImage(image.element,src.x,src.y,src.width,src.height,dest.x,dest.y,dest.width,dest.height)},
  }),makeImageSnapshot:()=>({dispose,encodeToBase64:()=>element.toDataURL('image/png').split(',')[1]})};
 }}
};
`;
