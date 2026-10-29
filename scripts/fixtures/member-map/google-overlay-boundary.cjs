// Synthetic Google provider boundary only. Real marker DOM/CSS/React lifecycle runs.
module.exports = `
import React,{useSyncExternalStore} from 'react';
const fixture=()=>window.mapFixture||window.fixture;
const map={panTo:p=>{fixture().camera=p;fixture().mapFocus=p},setZoom:z=>{fixture().zoom=z;fixture().mapZoom=z}};
const used=new Set();
class OverlayView {
 static preventMapHitsAndGesturesFrom(element){element.dataset.gestureIsolated='true'}
 setMap(value){if(value){this.index=0;while(used.has(this.index))this.index++;used.add(this.index);this.onAdd();this.draw()}else{used.delete(this.index);this.onRemove()}}
 getPanes(){return {overlayMouseTarget:document.querySelector('[data-testid="google-map"],[data-testid="unified-map"]')}}
 getProjection(){return {fromLatLngToDivPixel:position=>{window.reportFixtureMarker?.({...position});return fixture().coordinateProjection ? {x:150+(position.lng+74.01)*1000,y:150-(position.lat-40.71)*1000} : {x:30+(this.index%4)*60,y:80+Math.floor(this.index/4)*70}}}}
}
const maps={OverlayView};
export const useMap=()=>map;
export const useMapsLibrary=()=>maps;
export const APILoadingStatus={LOADED:'loaded',FAILED:'failed',AUTH_FAILURE:'auth_failure'};
export const useApiLoadingStatus=()=>useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>fixture().providerStatus||fixture().status||'loaded');
export const APIProvider=({children,apiKey})=>{fixture().providerKey=apiKey;return children};
export const Map=({children})=><div data-testid={window.mapFixture?'unified-map':'google-map'} style={{position:'relative',width:'100%',height:'100%',overflow:'hidden'}}>{children}</div>;
`;
