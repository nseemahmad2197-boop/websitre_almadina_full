export class BodyLimitError extends Error {
  readonly status: number;
  constructor(status: number) { super("Request body limit exceeded"); this.status = status; }
}

/** Bound both bytes and total stream time; never wait for a hostile cancel(). */
export async function readBoundedBody(body: ReadableStream<Uint8Array>, maxBytes: number, timeoutMs = 10_000): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new BodyLimitError(408)), timeoutMs); });
  let buffer = new Uint8Array(Math.min(maxBytes, 16_384));
  let length = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      if (!value) continue;
      length += value.byteLength;
      if (length > maxBytes) throw new BodyLimitError(413);
      if (length > buffer.length) {
        const expanded = new Uint8Array(Math.min(maxBytes, Math.max(length, buffer.length * 2)));
        expanded.set(buffer);
        buffer = expanded;
      }
      buffer.set(value, length - value.byteLength);
    }
    return buffer.subarray(0, length);
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
