import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ScannerOverlay } from "../app/almadina-app";
import { createQrMatrix } from "../app/lib/qr-code";

type CameraTest = {
  requests: number;
  denied: boolean;
  permission: PermissionState | "unsupported";
  pending: boolean;
  decodeFailure: boolean;
  detachedAttachments: number;
  streams: MediaStream[];
  constraints: MediaStreamConstraints[];
  release: () => void;
  draw: (text: string, moduleSize?: number) => void;
};
declare global { interface Window { cameraTest: CameraTest } }
const canvases: HTMLCanvasElement[] = [];
const test: CameraTest = window.cameraTest = {
  requests: 0, denied: false, permission: "unsupported", pending: false, decodeFailure: false,
  detachedAttachments: 0, streams: [], constraints: [], release: () => {},
  draw(text, moduleSize = 16) {
    const matrix = createQrMatrix(text);
    const left = (640 - matrix.length * moduleSize) / 2;
    const top = (480 - matrix.length * moduleSize) / 2;
    for (const canvas of canvases) {
      const context = canvas.getContext("2d")!;
      context.fillStyle = "white"; context.fillRect(0, 0, 640, 480);
      context.fillStyle = "black";
      matrix.forEach((row, y) => row.forEach((dark, x) => {
        if (dark) context.fillRect(left + x * moduleSize, top + y * moduleSize, moduleSize, moduleSize);
      }));
      (test.streams[canvases.indexOf(canvas)].getVideoTracks()[0] as CanvasCaptureMediaStreamTrack).requestFrame();
    }
  },
};
Object.defineProperty(navigator.permissions, "query", { configurable: true, value: async () => {
  if (test.permission === "unsupported") throw new TypeError("Camera permission queries unsupported");
  return { state: test.permission };
} });
Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async (constraints: MediaStreamConstraints) => {
  test.requests += 1; test.constraints.push(constraints);
  if (test.denied) throw new DOMException("Permission denied", "NotAllowedError");
  const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
  const context = canvas.getContext("2d")!; context.fillStyle = "white"; context.fillRect(0, 0, 640, 480);
  const stream = canvas.captureStream(10); canvases.push(canvas); test.streams.push(stream);
  if (test.pending) await new Promise<void>((resolve) => { test.release = resolve; });
  return stream;
} });
const source = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "srcObject")!;
Object.defineProperty(HTMLMediaElement.prototype, "srcObject", { ...source, set(value) {
  if (value && !document.contains(this)) test.detachedAttachments += 1;
  source.set!.call(this, value);
} });
const drawImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof drawImage>) {
  if (test.decodeFailure && args[0] instanceof HTMLVideoElement) throw new DOMException("Video frame unavailable", "InvalidStateError");
  return drawImage.apply(this, args);
} as typeof drawImage;

function Fixture() {
  const [mode, setMode] = useState<"lookup" | "employee" | "assign-parcel-code" | null>(null);
  const [detected, setDetected] = useState<string[]>([]);
  return <main dir="rtl">
    <button onClick={() => setMode("lookup")}>فتح التتبع</button>
    <button onClick={() => setMode("employee")}>فتح شحن الموظف</button>
    <button onClick={() => setMode("assign-parcel-code")}>فتح ربط كود الطرد</button>
    <output id="detected">{JSON.stringify(detected)}</output>
    {mode && <ScannerOverlay purpose={mode === "assign-parcel-code" ? mode : "lookup"} employeeMode={mode === "employee"} onClose={() => setMode(null)} onDetected={(value) => setDetected((previous) => [...previous, value])} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
