import { BrowserQRCodeReader } from "@zxing/browser";

// A frame without a complete QR is expected while aiming the camera.
export function isQrFrameMiss(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const kind = "getKind" in error && typeof error.getKind === "function" ? error.getKind() : error.name;
  return ["NotFoundException", "ChecksumException", "FormatException"].includes(kind);
}

export class CameraQrReader extends BrowserQRCodeReader {
  private readonly smallerFrames: HTMLCanvasElement[] = [];

  override decodeFromCanvas(canvas: HTMLCanvasElement) {
    let lastError: unknown;
    try {
      return super.decodeFromCanvas(canvas);
    } catch (error) {
      if (!isQrFrameMiss(error)) throw error;
      lastError = error;
    }

    // Large QR modules can confuse the finder's candidate selection. Retry the
    // same frame at two smaller sizes, retaining the normal perspective decoder.
    // Reuse both canvases and cap their long edges to bound work on HD cameras.
    const longEdge = Math.max(canvas.width, canvas.height);
    for (const [index, limit] of [640, 320].entries()) {
      const ratio = Math.min(limit / longEdge, 1 / (2 ** (index + 1)));
      const width = Math.round(canvas.width * ratio);
      const height = Math.round(canvas.height * ratio);
      if (Math.min(width, height) < 64) break;
      const smaller = this.smallerFrames[index] ??= document.createElement("canvas");
      if (smaller.width !== width) smaller.width = width;
      if (smaller.height !== height) smaller.height = height;
      const context = smaller.getContext("2d", { willReadFrequently: true });
      if (!context) throw lastError;
      context.drawImage(canvas, 0, 0, width, height);
      try {
        return super.decodeFromCanvas(smaller);
      } catch (error) {
        if (!isQrFrameMiss(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }
}
