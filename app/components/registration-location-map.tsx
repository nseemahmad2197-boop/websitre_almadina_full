"use client";

/* eslint-disable @next/next/no-img-element -- OpenStreetMap tiles are dynamic coordinate images and cannot use static image optimization. */

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Icon } from "./icon";

type MapPoint = { latitude: number; longitude: number };

type RegistrationLocationMapProps = MapPoint & {
  confirmed: boolean;
  confirmDisabled?: boolean;
  onChange: (point: MapPoint) => void;
  onConfirm: (point: MapPoint) => void | Promise<void>;
  onError: (message: string) => void;
};

const TILE_SIZE = 256;
const MIN_ZOOM = 7;
const MAX_ZOOM = 17;
const SERVICE_BOUNDS = { minLatitude: 29.35, maxLatitude: 33.55, minLongitude: 34.1, maxLongitude: 35.95 };

export const REGISTRATION_REGION_CENTERS: Record<string, MapPoint> = {
  "الخليل": { latitude: 31.5326, longitude: 35.0998 },
  "بيت لحم": { latitude: 31.7054, longitude: 35.2024 },
  "رام الله والبيرة": { latitude: 31.9038, longitude: 35.2034 },
  "القدس": { latitude: 31.7683, longitude: 35.2137 },
  "نابلس": { latitude: 32.2211, longitude: 35.2544 },
  "جنين": { latitude: 32.4594, longitude: 35.3009 },
  "طولكرم": { latitude: 32.3104, longitude: 35.0286 },
  "قلقيلية": { latitude: 32.196, longitude: 34.981 },
  "سلفيت": { latitude: 32.0837, longitude: 35.1808 },
  "أريحا والأغوار": { latitude: 31.857, longitude: 35.4444 },
  "طوباس": { latitude: 32.3214, longitude: 35.3699 },
  "الداخل": { latitude: 32.45, longitude: 35.05 },
};

export const DEFAULT_REGISTRATION_MAP_POINT: MapPoint = { latitude: 31.9038, longitude: 35.2034 };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function coordinateToWorld(latitude: number, longitude: number, zoom: number) {
  const size = TILE_SIZE * 2 ** zoom;
  const boundedLatitude = clamp(latitude, -85.05112878, 85.05112878);
  const sine = Math.sin((boundedLatitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size,
  };
}

function worldToCoordinate(x: number, y: number, zoom: number): MapPoint {
  const size = TILE_SIZE * 2 ** zoom;
  const normalizedX = ((x % size) + size) % size;
  const boundedY = clamp(y, 0, size);
  const longitude = (normalizedX / size) * 360 - 180;
  const mercator = Math.PI - (2 * Math.PI * boundedY) / size;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(mercator));
  return { latitude: roundCoordinate(latitude), longitude: roundCoordinate(longitude) };
}

function isInsideServiceArea(point: MapPoint): boolean {
  return point.latitude >= SERVICE_BOUNDS.minLatitude
    && point.latitude <= SERVICE_BOUNDS.maxLatitude
    && point.longitude >= SERVICE_BOUNDS.minLongitude
    && point.longitude <= SERVICE_BOUNDS.maxLongitude;
}

export function RegistrationLocationMap({
  latitude,
  longitude,
  confirmed,
  confirmDisabled = false,
  onChange,
  onConfirm,
  onError,
}: RegistrationLocationMapProps) {
  const [zoom, setZoom] = useState(10);
  const [dragging, setDragging] = useState(false);
  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    worldX: number;
    worldY: number;
    moved: boolean;
  } | null>(null);

  const world = coordinateToWorld(latitude, longitude, zoom);
  const tiles = useMemo(() => {
    const tileCount = 2 ** zoom;
    const centerTileX = Math.floor(world.x / TILE_SIZE);
    const centerTileY = Math.floor(world.y / TILE_SIZE);
    return Array.from({ length: 25 }, (_, index) => {
      const offsetX = (index % 5) - 2;
      const offsetY = Math.floor(index / 5) - 2;
      const tileX = centerTileX + offsetX;
      const tileY = centerTileY + offsetY;
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      return {
        key: `${zoom}-${tileX}-${tileY}`,
        hidden: tileY < 0 || tileY >= tileCount,
        url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`,
        left: tileX * TILE_SIZE - world.x,
        top: tileY * TILE_SIZE - world.y,
      };
    });
  }, [world.x, world.y, zoom]);

  function moveByPixels(horizontal: number, vertical: number) {
    const current = coordinateToWorld(latitude, longitude, zoom);
    onChange(worldToCoordinate(current.x + horizontal, current.y + vertical, zoom));
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const start = coordinateToWorld(latitude, longitude, zoom);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      worldX: start.x,
      worldY: start.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) drag.moved = true;
    onChange(worldToCoordinate(drag.worldX - deltaX, drag.worldY - deltaY, zoom));
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && surfaceRef.current) {
      const bounds = surfaceRef.current.getBoundingClientRect();
      const horizontal = event.clientX - (bounds.left + bounds.width / 2);
      const vertical = event.clientY - (bounds.top + bounds.height / 2);
      moveByPixels(horizontal, vertical);
    }
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function keyboardMove(event: KeyboardEvent<HTMLDivElement>) {
    const movement: Record<string, [number, number]> = {
      ArrowUp: [0, -48],
      ArrowDown: [0, 48],
      ArrowLeft: [-48, 0],
      ArrowRight: [48, 0],
    };
    if (movement[event.key]) {
      event.preventDefault();
      moveByPixels(...movement[event.key]);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoom((current) => Math.min(MAX_ZOOM, current + 1));
    } else if (event.key === "-") {
      event.preventDefault();
      setZoom((current) => Math.max(MIN_ZOOM, current - 1));
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      onError("تحديد الموقع غير مدعوم في هذا الجهاز. حرّك الخريطة وحدد النقطة يدويًا.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition((position) => {
      setLocating(false);
      const point = {
        latitude: roundCoordinate(position.coords.latitude),
        longitude: roundCoordinate(position.coords.longitude),
      };
      if (!isInsideServiceArea(point)) {
        onError("موقع الجهاز خارج نطاق التوصيل. اختر عنوان المتجر يدويًا من الخريطة.");
        return;
      }
      onChange(point);
      setZoom(15);
    }, () => {
      setLocating(false);
      onError("تعذّر الوصول إلى موقع الجهاز. اسمح بالوصول للموقع أو اختر النقطة يدويًا.");
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
  }

  async function confirmLocation() {
    if (confirmDisabled || resolving) return;
    setResolving(true);
    try {
      await onConfirm({ latitude, longitude });
    } catch {
      onError("تم تثبيت النقطة، لكن تعذّرت قراءة العنوان تلقائيًا. اختر المدينة والمنطقة والشارع يدويًا.");
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className={`registration-map ${confirmed ? "is-confirmed" : ""}`}>
      <div
        ref={surfaceRef}
        className={`registration-map__surface ${dragging ? "is-dragging" : ""}`}
        role="application"
        aria-label="خريطة اختيار عنوان الحساب. حرّك الخريطة أو اضغط على موضع ثم ثبّت الموقع."
        aria-describedby="registration-map-help"
        tabIndex={0}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onKeyDown={keyboardMove}
      >
        <div className="registration-map__tiles" aria-hidden="true">
          {tiles.map((tile) => tile.hidden ? null : <img
            key={tile.key}
            src={tile.url}
            alt=""
            draggable={false}
            style={{ left: `calc(50% + ${tile.left}px)`, top: `calc(50% + ${tile.top}px)` }}
          />)}
        </div>
        <span className="registration-map__pin" aria-hidden="true"><Icon name="mapPin" size={33} /></span>
        <div className="registration-map__zoom" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" aria-label="تكبير الخريطة" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current + 1))}>+</button>
          <button type="button" aria-label="تصغير الخريطة" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom((current) => Math.max(MIN_ZOOM, current - 1))}>−</button>
        </div>
        <button className="registration-map__locate" type="button" disabled={locating} onPointerDown={(event) => event.stopPropagation()} onClick={useCurrentLocation}>
          <Icon name="mapPin" size={15} />{locating ? "جارٍ التحديد..." : "موقعي"}
        </button>
        <button className="registration-map__confirm" type="button" disabled={confirmDisabled || resolving} aria-busy={resolving} onPointerDown={(event) => event.stopPropagation()} onClick={() => { void confirmLocation(); }}>
          <Icon name={resolving ? "clock" : confirmed ? "check" : "mapPin"} size={15} />{resolving ? "جارٍ قراءة العنوان..." : confirmed ? "تم تحديد الموقع" : "تثبيت وقراءة العنوان"}
        </button>
        <a className="registration-map__attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()}>© OpenStreetMap</a>
      </div>
      <p id="registration-map-help" className="registration-map__help">
        <Icon name={confirmed ? "check" : "info"} size={15} />
        {resolving ? "نقرأ الآن المدينة والمنطقة والشارع من موضع الدبوس." : confirmed ? "تم حفظ النقطة. يمكنك تعديل المدينة والمنطقة والشارع يدويًا عند الحاجة." : "حرّك الخريطة حتى يصبح الدبوس فوق موقعك، ثم اضغط «تثبيت وقراءة العنوان»."}
      </p>
    </div>
  );
}
