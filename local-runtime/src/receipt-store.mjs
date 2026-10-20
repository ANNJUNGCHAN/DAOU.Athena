import { randomBytes } from 'node:crypto';
import { link, mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import { ProtocolValidationError } from '../../contracts/wts-foundation.mjs';

import { StorageError } from './errors.mjs';

const MAX_RECEIPTS = 10_000;
const MAX_RECEIPT_BYTES = 128 * 1024;
const MAX_OWNED_TEMP_FILES = 1_024;
const UUID_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/iu;
const OWNED_TEMP_PATTERN = /^\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.\d+-\d+-[0-9a-f]{12}\.tmp$/iu;

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class ReceiptStore {
  constructor(
    dataDir,
    validateReceipt,
    fileSystem = { link, mkdir, open, readFile, readdir, stat, unlink },
  ) {
    this.receiptsDir = path.join(dataDir, 'receipts');
    this.validateReceipt = validateReceipt;
    this.fileSystem = fileSystem;
  }

  #receiptPath(receiptId) {
    return path.join(this.receiptsDir, `${receiptId.toLowerCase()}.json`);
  }

  async #read(receiptId) {
    try {
      const filePath = this.#receiptPath(receiptId);
      const fileStat = await this.fileSystem.stat(filePath);
      if (!fileStat.isFile() || fileStat.size > MAX_RECEIPT_BYTES) {
        throw new StorageError('RECEIPT_STORAGE_CORRUPT', 'Receipt storage is not a bounded regular file.');
      }
      const receipt = JSON.parse(await this.fileSystem.readFile(filePath, 'utf8'));
      this.validateReceipt(receipt);
      if (receipt.id.toLowerCase() !== receiptId.toLowerCase()) {
        throw new StorageError('RECEIPT_STORAGE_CORRUPT', 'Receipt file identity does not match its name.');
      }
      return receipt;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      if (error instanceof StorageError) throw error;
      if (error instanceof ProtocolValidationError) {
        throw new StorageError('RECEIPT_STORAGE_CORRUPT', 'Receipt storage failed protocol validation.', { cause: error });
      }
      if (error instanceof SyntaxError) {
        throw new StorageError('RECEIPT_STORAGE_CORRUPT', 'Receipt storage contains invalid JSON.', { cause: error });
      }
      throw new StorageError('RECEIPT_STORAGE_READ_FAILED', 'Receipt storage could not be read.', { cause: error });
    }
  }

  async #list() {
    let entries;
    try {
      entries = await this.fileSystem.readdir(this.receiptsDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw new StorageError('RECEIPT_STORAGE_READ_FAILED', 'Receipt directory could not be read.', { cause: error });
    }
    let count = 0;
    let ownedTempCount = 0;
    const receiptIds = [];
    for (const entry of entries) {
      if (entry.isFile() && UUID_FILE_PATTERN.test(entry.name)) {
        count += 1;
        receiptIds.push(entry.name.slice(0, -'.json'.length));
      } else if (entry.isFile() && OWNED_TEMP_PATTERN.test(entry.name)) {
        ownedTempCount += 1;
      } else {
        throw new StorageError('RECEIPT_STORAGE_CORRUPT', 'Receipt directory contains unexpected files.');
      }
    }
    if (count > MAX_RECEIPTS || ownedTempCount > MAX_OWNED_TEMP_FILES) {
      throw new StorageError('RECEIPT_STORAGE_CORRUPT', 'Receipt directory exceeds its bounded limit.');
    }
    const receipts = [];
    for (const receiptId of receiptIds) receipts.push(await this.#read(receiptId));
    return receipts;
  }

  async #write(receipt) {
    const serialized = `${JSON.stringify(receipt)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_RECEIPT_BYTES) {
      throw new StorageError('RECEIPT_STORAGE_LIMIT', 'Receipt storage size limit reached.');
    }
    let temporaryPath = null;
    try {
      await this.fileSystem.mkdir(this.receiptsDir, { recursive: true });
      const suffix = `${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`;
      temporaryPath = path.join(this.receiptsDir, `.${receipt.id}.${suffix}.tmp`);
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
          try { await handle.close(); } catch (error) { writeError ??= error; }
        }
      }
      if (writeError) throw writeError;
      await this.fileSystem.link(temporaryPath, this.#receiptPath(receipt.id));
      await this.fileSystem.unlink(temporaryPath);
      temporaryPath = null;
    } catch (error) {
      if (temporaryPath) await this.fileSystem.unlink(temporaryPath).catch(() => {});
      if (error instanceof StorageError) throw error;
      if (error?.code === 'EEXIST') {
        throw new StorageError('RECEIPT_ALREADY_EXISTS', 'Receipt was published concurrently.', { cause: error });
      }
      throw new StorageError('RECEIPT_STORAGE_WRITE_FAILED', 'Receipt storage could not be written.', { cause: error });
    }
  }

  async record(receipt) {
    this.validateReceipt(receipt);
    const existing = await this.#read(receipt.id);
    if (existing) {
      if (!sameJson(existing, receipt)) {
        throw new StorageError('RECEIPT_ID_CONFLICT', 'Receipt id already exists with different metadata.');
      }
      return { receiptId: receipt.id, stored: true };
    }
    if ((await this.#list()).length >= MAX_RECEIPTS) {
      throw new StorageError('RECEIPT_STORAGE_LIMIT', 'Receipt storage limit reached.');
    }
    const sanitized = JSON.parse(JSON.stringify(receipt));
    try {
      await this.#write(sanitized);
    } catch (error) {
      if (!(error instanceof StorageError) || error.code !== 'RECEIPT_ALREADY_EXISTS') throw error;
      const concurrent = await this.#read(receipt.id);
      if (!concurrent || !sameJson(concurrent, receipt)) {
        throw new StorageError('RECEIPT_ID_CONFLICT', 'Receipt id was concurrently stored with different metadata.');
      }
    }
    return { receiptId: receipt.id, stored: true };
  }
}
