import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createProtocolValidator,
  HOST_NAME,
  MAX_MESSAGE_BYTES,
} from '../../contracts/wts-foundation.mjs';

import { assertAuthorizedOrigin, loadHostConfig } from './config.mjs';
import { BackendSupervisor } from './backend-supervisor.mjs';
import { ControlPlanner } from './control-planner.mjs';
import { HostError } from './errors.mjs';
import { FinancialBackendSupervisor } from './financial-backend-supervisor.mjs';
import { FinancialSourceBridge } from './financial-source-bridge.mjs';
import { NativeMessageDecoder, writeNativeMessage } from './framing.mjs';
import { createRequestHandler } from './host.mjs';
import { InventoryStore } from './inventory-store.mjs';
import { ReceiptStore } from './receipt-store.mjs';
import { SourceBridge } from './source-bridge.mjs';
import { TaskEngine } from './task-engine.mjs';
import { TaskStore } from './task-store.mjs';
import { ProviderCoordinator } from './chatgpt-provider/provider-coordinator.mjs';

function safeDiagnostic(error) {
  if (error instanceof HostError) {
    return `${error.code}: ${error.message}`;
  }
  return 'HOST_FATAL: Native host stopped because of an internal error.';
}

async function loadJson(url, label) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch (error) {
    throw new HostError('INSTALLATION_INVALID', `${label} could not be loaded.`, { cause: error });
  }
}

export async function runNativeHost({
  stdin = process.stdin,
  stdout = process.stdout,
  callerOrigin = process.argv[2],
  configPath = process.env.ATHENA_WTS_HOST_CONFIG,
  createSupervisor = (options) => new BackendSupervisor(options),
  createSourceBridge = (supervisor) => new SourceBridge(supervisor),
  createFinancialSupervisor = (options) => new FinancialBackendSupervisor(options),
  createFinancialSourceBridge = (supervisor) => new FinancialSourceBridge(supervisor),
  createProviderCoordinator = (options) => new ProviderCoordinator(options),
  createId = randomUUID,
} = {}) {
  const [config, schema, packageMetadata] = await Promise.all([
    loadHostConfig(configPath),
    loadJson(new URL('../../contracts/wts-foundation.protocol.schema.json', import.meta.url), 'Protocol schema'),
    loadJson(new URL('../package.json', import.meta.url), 'Runtime package metadata'),
  ]);
  if (config.hostName !== HOST_NAME) {
    throw new HostError('CONFIG_INVALID', 'Configured native host name does not match this runtime.');
  }
  assertAuthorizedOrigin(callerOrigin, config.allowedOrigin);

  const shutdownController = new AbortController();
  let backendSupervisor = null;
  let sourceBridge = null;
  let financialSupervisor = null;
  let financialSourceBridge = null;
  if (config.backendRoot !== null) {
    const backendStateRoot = path.join(config.dataDir, 'backend-v4');
    await mkdir(backendStateRoot, { recursive: true, mode: 0o700 });
    backendSupervisor = createSupervisor({
      backendRoot: config.backendRoot,
      pythonExecutable: config.pythonExecutable,
      stateDir: path.join(backendStateRoot, createId()),
    });
    sourceBridge = createSourceBridge(backendSupervisor);
    financialSupervisor = createFinancialSupervisor({
      backendRoot: config.backendRoot,
      pythonExecutable: config.pythonExecutable,
      dataDir: config.dataDir,
      stateDir: path.join(config.dataDir, `financial-backend-v1-${createId()}`),
    });
    financialSourceBridge = createFinancialSourceBridge(financialSupervisor);
  }

  const providerCoordinator = createProviderCoordinator({ dataRoot: config.dataDir });

  let shutdownPromise = null;
  const requestShutdown = () => {
    shutdownController.abort();
    if (shutdownPromise === null) {
      providerCoordinator.shutdown();
      shutdownPromise = Promise.allSettled([
        Promise.resolve(backendSupervisor?.stop()),
        Promise.resolve(financialSupervisor?.stop()),
      ]).then((results) => {
        const rejected = results.find((result) => result.status === 'rejected');
        if (rejected) throw rejected.reason;
      });
      void shutdownPromise.catch(() => {});
    }
    return shutdownPromise;
  };
  stdin.once('end', requestShutdown);
  stdin.once('close', requestShutdown);
  stdin.once('error', requestShutdown);

  const validator = createProtocolValidator(schema);
  const planner = new ControlPlanner();
  const receiptStore = new ReceiptStore(config.dataDir, validator.validateControlReceipt);
  const taskStore = new TaskStore(
    config.dataDir,
    validator.validateControlTask,
    validator.validateControlReceipt,
  );
  const taskEngine = new TaskEngine({
    planner,
    taskStore,
    receiptStore,
    validateTask: validator.validateControlTask,
    validateReceipt: validator.validateControlReceipt,
  });
  const handleRequest = createRequestHandler({
    validator,
    store: new InventoryStore(config.dataDir, validator.validateCapture),
    planner,
    receiptStore,
    taskEngine,
    runtimeVersion: packageMetadata.version,
    backendSupervisor,
    sourceBridge,
    financialSupervisor,
    financialSourceBridge,
    providerCoordinator,
    signal: shutdownController.signal,
  });
  const decoder = new NativeMessageDecoder(MAX_MESSAGE_BYTES);

  try {
    for await (const chunk of stdin) {
      for (const payload of decoder.push(chunk)) {
        let request;
        try {
          const json = new TextDecoder('utf-8', { fatal: true }).decode(payload);
          request = JSON.parse(json);
        } catch (error) {
          throw new HostError('INVALID_JSON', 'Native request is not valid UTF-8 JSON.', { cause: error });
        }
        const response = await handleRequest(request);
        try {
          await writeNativeMessage(stdout, response, MAX_MESSAGE_BYTES);
        } catch (error) {
          void requestShutdown();
          if (typeof stdin.destroy === 'function' && !stdin.destroyed) stdin.destroy();
          if (typeof stdout.destroy === 'function' && !stdout.destroyed) stdout.destroy();
          throw error;
        }
      }
    }
    decoder.finish();
  } finally {
    stdin.off('end', requestShutdown);
    stdin.off('close', requestShutdown);
    stdin.off('error', requestShutdown);
    await requestShutdown();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runNativeHost().catch((error) => {
    process.stderr.write(`${safeDiagnostic(error)}\n`);
    process.exitCode = 1;
  });
}
