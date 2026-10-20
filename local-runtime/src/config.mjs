import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { HostError } from './errors.mjs';

const CONFIG_KEYS = new Set([
  'hostName', 'allowedOrigin', 'dataDir', 'backendRoot', 'pythonExecutable',
]);
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}\/$/u;

export async function loadHostConfig(configPath) {
  if (!configPath) {
    throw new HostError('CONFIG_REQUIRED', 'Native host configuration path is required.');
  }

  let value;
  try {
    value = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    throw new HostError('CONFIG_INVALID', 'Native host configuration could not be loaded.', { cause: error });
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HostError('CONFIG_INVALID', 'Native host configuration must be an object.');
  }
  const unknown = Object.keys(value).filter((key) => !CONFIG_KEYS.has(key));
  if (unknown.length > 0) {
    throw new HostError('CONFIG_INVALID', 'Native host configuration contains unsupported fields.');
  }
  if (typeof value.hostName !== 'string' || value.hostName.length === 0) {
    throw new HostError('CONFIG_INVALID', 'Native host name is required.');
  }
  if (typeof value.allowedOrigin !== 'string' || !EXTENSION_ORIGIN.test(value.allowedOrigin)) {
    throw new HostError('CONFIG_INVALID', 'Native host allowed origin is invalid.');
  }
  if (typeof value.dataDir !== 'string' || !path.isAbsolute(value.dataDir)) {
    throw new HostError('CONFIG_INVALID', 'Native host data directory must be absolute.');
  }
  const backendConfigured = value.backendRoot !== undefined && value.backendRoot !== null;
  const pythonConfigured = value.pythonExecutable !== undefined && value.pythonExecutable !== null;
  if (backendConfigured !== pythonConfigured) {
    throw new HostError(
      'CONFIG_INVALID',
      'Read-only backend root and Python executable must be configured together.',
    );
  }
  if (backendConfigured && (
    typeof value.backendRoot !== 'string' || !path.isAbsolute(value.backendRoot) ||
    typeof value.pythonExecutable !== 'string' || !path.isAbsolute(value.pythonExecutable)
  )) {
    throw new HostError('CONFIG_INVALID', 'Read-only backend paths must be absolute.');
  }

  return Object.freeze({
    hostName: value.hostName,
    allowedOrigin: value.allowedOrigin,
    dataDir: path.resolve(value.dataDir),
    backendRoot: backendConfigured ? path.resolve(value.backendRoot) : null,
    pythonExecutable: pythonConfigured ? path.resolve(value.pythonExecutable) : null,
  });
}

export function assertAuthorizedOrigin(origin, allowedOrigin) {
  if (typeof origin !== 'string' || origin.length === 0) {
    throw new HostError('CALLER_ORIGIN_REQUIRED', 'Chrome extension caller origin is required.');
  }
  if (origin !== allowedOrigin) {
    throw new HostError('CALLER_ORIGIN_DENIED', 'Chrome extension caller origin is not authorized.');
  }
}
