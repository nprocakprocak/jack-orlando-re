// Little-endian view of a byte slice, including a view into a larger buffer.

export function viewOf(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}
