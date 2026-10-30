"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";

/** DOM overlays can clip remote images without a CORS canvas or a new map ID. */
export function RoundedMapMarker({ latitude, longitude, title, source, fallback, height = 44, width = 44, unframed = false, children, onClick }: {
  latitude: number; longitude: number; title: string; source: string | null;
  fallback: string; height?: number; width?: number; unframed?: boolean; children?: ReactNode; onClick: () => void;
}) {
  const map = useMap();
  const maps = useMapsLibrary("maps");
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);

  useEffect(() => {
    if (!map || !maps) return;
    const element = document.createElement("div");
    element.style.position = "absolute";
    element.style.transform = "translate(-50%, -100%)";
    const overlay = new maps.OverlayView();
    overlay.onAdd = () => {
      overlay.getPanes()?.overlayMouseTarget.appendChild(element);
      maps.OverlayView.preventMapHitsAndGesturesFrom(element);
      setContainer(element);
    };
    overlay.draw = () => {
      const point = overlay.getProjection()?.fromLatLngToDivPixel({ lat: latitude, lng: longitude });
      if (point) { element.style.left = `${point.x}px`; element.style.top = `${point.y}px`; }
    };
    overlay.onRemove = () => { element.remove(); };
    overlay.setMap(map);
    return () => { overlay.setMap(null); setContainer(null); };
  }, [map, maps, latitude, longitude]);

  if (!container) return null;
  return createPortal(
    <button type="button" aria-label={title} title={unframed ? undefined : title} onClick={onClick}
      data-map-marker data-lat={latitude} data-lng={longitude}
      className={`rounded-sm text-white font-bold text-xs flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${unframed ? 'overflow-visible bg-transparent border-0 p-0' : 'overflow-hidden bg-[#8A40CF] border-2 border-white shadow-md'}`}
      style={{ width, height }}>
      {children || (source && failedSource !== source
        ? <img key={source} src={source} alt="" referrerPolicy="no-referrer" draggable={false}
            className="w-full h-full object-cover" onError={() => setFailedSource(source)} />
        : <span aria-hidden="true">{fallback}</span>)}
    </button>, container,
  );
}
