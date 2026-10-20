import { randomBytes } from 'node:crypto';
import { link, mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import { StorageError } from './errors.mjs';

const MAX_CAPTURES = 10_000;
const MAX_CAPTURE_BYTES = 128 * 1024;
const MAX_OWNED_TEMP_FILES = 1024;
const UUID_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/iu;
const OWNED_TEMP_PATTERN = /^\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.\d+-\d+-[0-9a-f]{12}\.tmp$/iu;

function validateCaptureSemantics(capture) {
  const first = capture.observations[0];
  const frameIdentities = new Set();
  const frameIds = new Set();
  let topFrameCount = 0;
  for (const observation of capture.observations) {
    if (observation.capturedAt !== capture.capturedAt) {
      throw new StorageError('CAPTURE_INVALID', 'Capture timestamps must match every observation.');
    }
    if (
      observation.source.tabId !== first.source.tabId ||
      observation.source.windowId !== first.source.windowId
    ) {
      throw new StorageError('CAPTURE_INVALID', 'Capture observations must belong to one tab and window.');
    }
    const identity = JSON.stringify([
      observation.source.tabId,
      observation.source.windowId,
      observation.source.frameId,
      observation.source.documentId,
    ]);
    if (frameIdentities.has(identity)) {
      throw new StorageError('CAPTURE_INVALID', 'Capture contains a duplicate frame identity.');
    }
    frameIdentities.add(identity);
    if (frameIds.has(observation.source.frameId)) {
      throw new StorageError('CAPTURE_INVALID', 'Capture contains a duplicate frame id.');
    }
    frameIds.add(observation.source.frameId);
    if (observation.source.frameId === 0) topFrameCount += 1;
  }
  if (topFrameCount !== 1) {
    throw new StorageError('CAPTURE_INVALID', 'Capture must contain exactly one top-frame observation.');
  }
}

export class InventoryStore {
  constructor(
    dataDir,
    validateCapture,
    fileSystem = { link, mkdir, open, readFile, readdir, stat, unlink },
  ) {
    this.capturesDir = path.join(dataDir, 'captures');
    this.validateCapture = validateCapture;
    this.fileSystem = fileSystem;
  }

  #capturePath(captureId) {
    return path.join(this.capturesDir, `${captureId.toLowerCase()}.json`);
  }

  async #readCapture(captureId) {
    const filePath = this.#capturePath(captureId);
    try {
      const fileStat = await this.fileSystem.stat(filePath);
      if (!fileStat.isFile() || fileStat.size > MAX_CAPTURE_BYTES) {
        throw new StorageError('STORAGE_CORRUPT', 'Capture storage is not a bounded regular file.');
      }
      const capture = JSON.parse(await this.fileSystem.readFile(filePath, 'utf8'));
      this.validateCapture(capture);
      validateCaptureSemantics(capture);
      if (capture.id.toLowerCase() !== captureId.toLowerCase()) {
        throw new StorageError('STORAGE_CORRUPT', 'Capture file identity does not match its name.');
      }
      return capture;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      if (error instanceof StorageError) throw error;
      if (error instanceof SyntaxError) {
        throw new StorageError('STORAGE_CORRUPT', 'Capture storage contains invalid JSON.', {
          cause: error,
        });
      }
      throw new StorageError('STORAGE_READ_FAILED', 'Capture storage could not be read.', {
        cause: error,
      });
    }
  }

  async #writeCapture(capture) {
    const serialized = `${JSON.stringify(capture)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_CAPTURE_BYTES) {
      throw new StorageError('STORAGE_LIMIT', 'Capture storage size limit reached.');
    }

    let temporaryPath = null;
    try {
      await this.fileSystem.mkdir(this.capturesDir, { recursive: true });
      const suffix = `${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`;
      temporaryPath = path.join(this.capturesDir, `.${capture.id}.${suffix}.tmp`);
      let handle;
      let writeError;
      try {
        handle = await this.fileSystem.open(temporaryPath, 'wx', 0o600);
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
      } catch (error) {
        writeError = error;
      } finally {
        if (handle) {
          try {
            await handle.close();
          } catch (error) {
            writeError ??= error;
          }
        }
      }
      if (writeError) throw writeError;
      await this.fileSystem.link(temporaryPath, this.#capturePath(capture.id));
      await this.fileSystem.unlink(temporaryPath);
      temporaryPath = null;
    } catch (error) {
      if (temporaryPath) await this.fileSystem.unlink(temporaryPath).catch(() => {});
      if (error instanceof StorageError) throw error;
      if (error?.code === 'EEXIST') {
        throw new StorageError('CAPTURE_ALREADY_EXISTS', 'Capture was published concurrently.', {
          cause: error,
        });
      }
      throw new StorageError('STORAGE_WRITE_FAILED', 'Capture storage could not be written.', {
        cause: error,
      });
    }
  }

  async #listCaptures() {
    let entries;
    try {
      entries = await this.fileSystem.readdir(this.capturesDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw new StorageError('STORAGE_READ_FAILED', 'Capture directory could not be read.', {
        cause: error,
      });
    }
    const captureEntries = [];
    let ownedTempCount = 0;
    for (const entry of entries) {
      if (entry.isFile() && UUID_FILE_PATTERN.test(entry.name)) {
        captureEntries.push(entry);
      } else if (entry.isFile() && OWNED_TEMP_PATTERN.test(entry.name)) {
        ownedTempCount += 1;
      } else {
        throw new StorageError('STORAGE_CORRUPT', 'Capture directory contains unexpected files.');
      }
    }
    if (captureEntries.length > MAX_CAPTURES || ownedTempCount > MAX_OWNED_TEMP_FILES) {
      throw new StorageError('STORAGE_CORRUPT', 'Capture directory contains unexpected files.');
    }
    const captures = [];
    for (const entry of captureEntries) {
      captures.push(await this.#readCapture(entry.name.slice(0, -'.json'.length)));
    }
    return captures;
  }

  async record(capture) {
    this.validateCapture(capture);
    validateCaptureSemantics(capture);
    const existing = await this.#readCapture(capture.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(capture)) {
        throw new StorageError('CAPTURE_ID_CONFLICT', 'Capture id already exists with different metadata.');
      }
      return {
        captureId: capture.id,
        observationCount: capture.observations.length,
        stored: true,
      };
    }

    const existingCaptures = await this.#listCaptures();
    if (existingCaptures.length >= MAX_CAPTURES) {
      throw new StorageError('STORAGE_LIMIT', 'Inventory capture limit reached.');
    }
    const sanitized = JSON.parse(JSON.stringify(capture));
    try {
      await this.#writeCapture(sanitized);
    } catch (error) {
      if (!(error instanceof StorageError) || error.code !== 'CAPTURE_ALREADY_EXISTS') {
        throw error;
      }
      const concurrent = await this.#readCapture(capture.id);
      if (!concurrent || JSON.stringify(concurrent) !== JSON.stringify(capture)) {
        throw new StorageError(
          'CAPTURE_ID_CONFLICT',
          'Capture id was concurrently stored with different metadata.',
        );
      }
    }
    return {
      captureId: capture.id,
      observationCount: capture.observations.length,
      stored: true,
    };
  }

  async summary() {
    const captures = await this.#listCaptures();
    const lastObservedAt = captures.reduce(
      (latest, capture) => (
        latest === null || capture.capturedAt > latest ? capture.capturedAt : latest
      ),
      null,
    );
    return {
      captureCount: captures.length,
      observationCount: captures.reduce(
        (count, capture) => count + capture.observations.length,
        0,
      ),
      lastObservedAt,
      coverage: 'partial',
      controlEnabled: true,
      layaReady: false,
    };
  }
}
