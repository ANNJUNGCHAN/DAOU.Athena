import { once } from 'node:events';

import { HostError } from './errors.mjs';

const HEADER_BYTES = 4;

export class NativeMessageDecoder {
  #header = Buffer.alloc(HEADER_BYTES);
  #headerBytes = 0;
  #maxMessageBytes;
  #payload = null;
  #payloadBytes = 0;

  constructor(maxMessageBytes) {
    this.#maxMessageBytes = maxMessageBytes;
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) {
      chunk = Buffer.from(chunk);
    }
    const messages = [];
    let offset = 0;
    while (offset < chunk.length) {
      if (this.#payload === null) {
        const headerLength = Math.min(HEADER_BYTES - this.#headerBytes, chunk.length - offset);
        chunk.copy(this.#header, this.#headerBytes, offset, offset + headerLength);
        this.#headerBytes += headerLength;
        offset += headerLength;
        if (this.#headerBytes < HEADER_BYTES) {
          continue;
        }

        const length = this.#header.readUInt32LE(0);
        this.#headerBytes = 0;
        if (length > this.#maxMessageBytes) {
          throw new HostError('MESSAGE_TOO_LARGE', 'Native message exceeds the maximum size.');
        }
        this.#payload = Buffer.allocUnsafe(length);
        this.#payloadBytes = 0;
        if (length === 0) {
          messages.push(Buffer.alloc(0));
          this.#payload = null;
        }
        continue;
      }

      const payloadLength = Math.min(
        this.#payload.length - this.#payloadBytes,
        chunk.length - offset,
      );
      chunk.copy(this.#payload, this.#payloadBytes, offset, offset + payloadLength);
      this.#payloadBytes += payloadLength;
      offset += payloadLength;
      if (this.#payloadBytes === this.#payload.length) {
        messages.push(this.#payload);
        this.#payload = null;
        this.#payloadBytes = 0;
      }
    }
    return messages;
  }

  finish() {
    if (this.#headerBytes !== 0 || this.#payload !== null) {
      throw new HostError('TRUNCATED_MESSAGE', 'Native message stream ended with a truncated frame.');
    }
  }
}

export function encodeNativeMessage(value, maxMessageBytes) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (payload.length > maxMessageBytes) {
    throw new HostError('MESSAGE_TOO_LARGE', 'Native response exceeds the maximum size.');
  }
  const frame = Buffer.allocUnsafe(HEADER_BYTES + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, HEADER_BYTES);
  return frame;
}

export async function writeNativeMessage(stream, value, maxMessageBytes) {
  const frame = encodeNativeMessage(value, maxMessageBytes);
  if (!stream.write(frame)) {
    await once(stream, 'drain');
  }
}
