/** Rejoin effect is extracted from the production screen by the test runner. */
import React, {act,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {startWebCallDevice} from '../../packages/app/features/call/start-web-call-device';
const check=(condition:unknown,message:string)=>{if(!condition)throw new Error(message)};
(window as any).runWebCallRejoinTests=async()=>{
 (window as any).IS_REACT_ACT_ENVIRONMENT=true;
 const cases:string[]=[];
 const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
 const drain=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
 async function session(mode='normal'){
  const el=document.createElement('div');document.body.append(el);const root=createRoot(el);const control:any={actions:[]};
  const store={roomId:'fixture-room',callPhase:'connected',setCameraOn:(on:boolean)=>control.actions.push('camera-state:'+on),setConnectionStatus:(status:string)=>control.actions.push('status:'+status),setError:()=>control.actions.push('error')};
  const getStore=()=>store;
  const callRoomsApi={joinCall:async()=>{control.actions.push('token');if(mode==='token')await new Promise(resolve=>control.resolveToken=resolve);return{ok:true,data:{token:'fixture-token',user:{id:'fixture-user'}}}}};
  function Screen(){
   const [peerStatus,setPeerStatus]=useState('error');control.setPeer=setPeerStatus;
   const intentionalLeaveRef=useRef(false),rejoinAttemptRef=useRef(0),cancelRejoinRef=useRef<(()=>void)|null>(null);
   const micRef=useRef({isMicrophoneOn:false,toggleMicrophone:async()=>{control.actions.push('mic');if(mode==='mic')await new Promise(resolve=>control.resolveMic=resolve);return undefined}});
   const cameraRef=useRef({isCameraOn:false,toggleCamera:async()=>{control.actions.push('camera');return mode==='cameraDenied'?{name:'NotAllowedError'}:undefined}});
   const joinRoomRef=useRef(async()=>{control.actions.push('join');setPeerStatus('connecting');await new Promise(resolve=>control.resolveJoin=resolve)});
   control.cancel=()=>{intentionalLeaveRef.current=true;cancelRejoinRef.current?.()};
   useEffect(()=>()=>cancelRejoinRef.current?.(),[]);
  /* __CALL_REJOIN_EFFECT__ */
   return null;
  }
  await act(async()=>root.render(<Screen/>));
  await act(async()=>{await sleep(1100);await drain()});
  return {control,async unmount(){await act(async()=>root.unmount());el.remove()}};
 }
 const normal=await session();check(normal.control.actions.includes('join'),'join started');
 await act(async()=>{normal.control.resolveJoin();normal.control.setPeer('connected');await drain()});
 check(normal.control.actions.includes('mic')&&normal.control.actions.includes('camera'),'connecting/connected rerenders must not cancel legitimate rejoin media');
 check(normal.control.actions.at(-1)==='status:connected','rejoin finishes connected');await normal.unmount();
 cases.push('actual screen effect survives error→connecting→connected during deferred join');
 const joined=await session();await joined.unmount();
 await act(async()=>{joined.control.resolveJoin();await drain()});
 check(!joined.control.actions.includes('mic')&&!joined.control.actions.includes('camera')&&!joined.control.actions.includes('status:connected'),'unmount while joining blocks late acquisition and connected state');
 cases.push('actual screen effect cancels deferred join on unmount');
 const pendingMic=await session('mic');
 await act(async()=>{pendingMic.control.resolveJoin();pendingMic.control.setPeer('connected');await drain()});
 check(pendingMic.control.actions.includes('mic'),'microphone acquisition began');await pendingMic.unmount();
 await act(async()=>{pendingMic.control.resolveMic();await drain()});
 check(!pendingMic.control.actions.includes('camera')&&!pendingMic.control.actions.includes('status:connected'),'unmount while acquiring microphone cannot start camera or write success');
 cases.push('actual screen effect blocks late microphone continuation');
 const pendingToken=await session('token');await act(async()=>pendingToken.control.cancel());
 await act(async()=>{pendingToken.control.resolveToken();await drain()});
 check(!pendingToken.control.actions.includes('join'),'explicit leave prevents stale token from joining');await pendingToken.unmount();
 cases.push('explicit leave prevents stale token admission');
 const audioOnly=await session('cameraDenied');
 await act(async()=>{audioOnly.control.resolveJoin();audioOnly.control.setPeer('connected');await drain()});
 check(audioOnly.control.actions.includes('status:connected'),'camera denial during rejoin must preserve connected audio instead of retrying the whole call');
 check(audioOnly.control.actions.filter((x:string)=>x==='join').length===1,'audio-only rejoin uses one peer admission');await audioOnly.unmount();
 cases.push('camera denial during rejoin preserves connected audio');
 return cases;
};
