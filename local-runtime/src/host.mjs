import {
  CONTROL_ACTION_IDS,
  CONVERSATION_ROUTER_ID,
  CONTROL_CATALOG_VERSION,
  FINANCIAL_API_VERSION,
  FINANCIAL_CARD_VERSION,
  FINANCIAL_ERROR_MESSAGES,
  FINANCIAL_METHODS,
  FINANCIAL_PROFILE,
  FINANCIAL_RENDER_KINDS,
  MARKET_MENU_PROFILE,
  ProtocolValidationError,
  PROTOCOL_VERSION,
  PROVIDER_ERROR_MESSAGES,
  PROVIDER_METHODS,
  RUNTIME_HELLO_PROVIDER_METADATA,
  SOURCE_API_VERSION,
  SOURCE_PROFILE,
} from '../../contracts/wts-foundation.mjs';

import { HostError, StorageError } from './errors.mjs';
import { FinancialBackendSupervisorError } from './financial-backend-supervisor.mjs';
import { FinancialSourceBridgeError } from './financial-source-bridge.mjs';
import { ProviderCoordinatorError } from './chatgpt-provider/provider-coordinator.mjs';
import { routeConversation } from './conversation-router.mjs';
import { TASK_COMPILER } from './task-compiler.mjs';

const METHODS = new Set([
  'runtime.hello',
  'backend.status',
  'backend.ensure',
  'source.manifest',
  'source.search',
  'source.describe',
  ...FINANCIAL_METHODS,
  'conversation.route',
  'inventory.record',
  'inventory.summary',
  'control.plan',
  'control.receipt.record',
  'control.task.start',
  'control.task.get',
  'control.task.next',
  'control.task.step.commit',
  'control.task.cancel',
  ...PROVIDER_METHODS,
]);
const SOURCE_METHODS = new Set(['source.manifest', 'source.search', 'source.describe']);
const FINANCIAL_METHOD_SET = new Set(FINANCIAL_METHODS);
const PROVIDER_METHOD_SET = new Set(PROVIDER_METHODS);

const BACKEND_STATES = new Set(['stopped', 'starting', 'ready', 'stopping', 'failed']);
const CATALOG_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_ERROR_CODE = /^(?:BACKEND|SOURCE)_[A-Z0-9_]{1,64}$/u;

function success(request, result) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: request.requestId,
    method: request.method,
    ok: true,
    result,
  };
}

function failure(request, code, message) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: request.requestId,
    method: request.method,
    ok: false,
    error: { code, message },
  };
}

function financialFailure(request, code) {
  return failure(request, code, FINANCIAL_ERROR_MESSAGES[code]);
}

function providerFailure(request, code) {
  return failure(request, code, PROVIDER_ERROR_MESSAGES[code]);
}

function canAddress(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.requestId === 'string' &&
    METHODS.has(value.method)
  );
}

function unconfiguredStatus() {
  return {
    configured: false,
    state: 'unconfigured',
    profile: SOURCE_PROFILE,
    apiVersion: null,
    catalogVersion: null,
    ownedChild: false,
  };
}

function configuredStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !BACKEND_STATES.has(value.state) || value.profile !== SOURCE_PROFILE ||
      (value.apiVersion !== null && value.apiVersion !== SOURCE_API_VERSION) ||
      (value.catalogVersion !== null && !CATALOG_PATTERN.test(value.catalogVersion)) ||
      typeof value.ownedChild !== 'boolean') {
    throw new HostError('SOURCE_RESPONSE_INVALID', 'Read-only backend status is invalid.');
  }
  return {
    configured: true,
    state: value.state,
    profile: SOURCE_PROFILE,
    apiVersion: value.apiVersion,
    catalogVersion: value.catalogVersion,
    ownedChild: value.ownedChild,
  };
}

function sourceFailure(error) {
  if (!error || typeof error.code !== 'string' || !SOURCE_ERROR_CODE.test(error.code)) return null;
  const message = error.code.startsWith('BACKEND_')
    ? 'Local read-only backend request failed.'
    : 'Local read-only source request failed.';
  return { code: error.code, message };
}

export function createRequestHandler({
  validator,
  store,
  planner,
  receiptStore,
  taskEngine,
  runtimeVersion,
  backendSupervisor = null,
  sourceBridge = null,
  financialSupervisor = null,
  financialSourceBridge = null,
  providerCoordinator = null,
  signal,
}) {
  return async function handleRequest(rawRequest) {
    let request;
    try {
      request = validator.validateRequest(rawRequest);
    } catch (error) {
      if (error instanceof ProtocolValidationError && canAddress(rawRequest)) {
        let response;
        if (FINANCIAL_METHOD_SET.has(rawRequest.method)) {
          response = financialFailure(rawRequest, 'REQUEST_INVALID');
        } else if (PROVIDER_METHOD_SET.has(rawRequest.method)) {
          response = providerFailure(rawRequest, 'PROVIDER_STATE_INVALID');
        } else {
          response = failure(
            rawRequest,
            error.code,
            'Request does not match the installed WTS protocol.',
          );
        }
        return validator.validateResponse(response);
      }
      throw new HostError('INVALID_PROTOCOL_MESSAGE', 'Native request cannot be safely addressed.', {
        cause: error,
      });
    }

    try {
      let result;
      switch (request.method) {
        case 'runtime.hello':
          result = {
            runtimeVersion,
            capabilities: {
              observationStorage: true,
              screenControl: true,
              laya: false,
              localPlanner: false,
            },
            control: {
              catalogVersion: CONTROL_CATALOG_VERSION,
              actions: CONTROL_ACTION_IDS,
              commandMode: 'bounded-korean-v3',
              taskMode: 'bounded-compound-v1',
              maxTaskSteps: 12,
              planner: {
                kind: 'deterministic',
                id: TASK_COMPILER.id,
                version: TASK_COMPILER.version,
                bundleHash: TASK_COMPILER.bundleHash,
                generative: false,
                localModelReady: false,
              },
              market: MARKET_MENU_PROFILE,
            },
            storage: 'user-local',
            lifecycle: 'native-port',
            source: {
              configured: backendSupervisor !== null,
              profile: SOURCE_PROFILE,
              apiVersion: SOURCE_API_VERSION,
              metadataOnly: true,
              financialQuery: false,
              externalAi: false,
            },
            financial: {
              configured: financialSupervisor !== null,
              profile: FINANCIAL_PROFILE,
              apiVersion: FINANCIAL_API_VERSION,
              cardVersion: FINANCIAL_CARD_VERSION,
              methods: FINANCIAL_METHODS,
              renderKinds: FINANCIAL_RENDER_KINDS,
              queryOnly: true,
              credentialSetup: true,
              order: false,
              websocket: false,
              externalAi: false,
            },
            conversation: {
              routerId: CONVERSATION_ROUTER_ID,
              generative: false,
              routes: ['wts-control', 'source-search'],
            },
            provider: RUNTIME_HELLO_PROVIDER_METADATA,
          };
          break;
        case 'backend.status':
          result = backendSupervisor === null
            ? unconfiguredStatus()
            : configuredStatus(backendSupervisor.status());
          break;
        case 'backend.ensure':
          if (backendSupervisor === null) {
            throw new HostError('SOURCE_NOT_CONFIGURED', 'Read-only source is not configured.');
          }
          result = configuredStatus(await backendSupervisor.ensure({ signal }));
          if (result.state !== 'ready') {
            throw new HostError('SOURCE_RESPONSE_INVALID', 'Read-only backend did not become ready.');
          }
          break;
        case 'source.manifest':
          if (sourceBridge === null) {
            throw new HostError('SOURCE_NOT_CONFIGURED', 'Read-only source is not configured.');
          }
          result = await sourceBridge.execute('manifest', request.params, { signal });
          break;
        case 'source.search':
          if (sourceBridge === null) {
            throw new HostError('SOURCE_NOT_CONFIGURED', 'Read-only source is not configured.');
          }
          result = await sourceBridge.execute('search', request.params, { signal });
          break;
        case 'source.describe':
          if (sourceBridge === null) {
            throw new HostError('SOURCE_NOT_CONFIGURED', 'Read-only source is not configured.');
          }
          result = await sourceBridge.execute('describe', request.params, { signal });
          break;
        case 'source.credentials.status':
        case 'source.credentials.configure':
        case 'source.credentials.delete':
        case 'source.query.start':
        case 'source.query.status':
        case 'source.query.page':
        case 'source.query.continue':
        case 'source.query.cancel':
          if (financialSourceBridge === null) {
            return validator.validateResponse(financialFailure(request, 'RESOURCE_NOT_FOUND'));
          }
          result = await financialSourceBridge.execute(request.method, request.params, { signal });
          break;
        case 'conversation.route':
          result = routeConversation(request.params);
          break;
        case 'inventory.record':
          validator.validateCapture(request.params.capture);
          result = await store.record(request.params.capture);
          break;
        case 'inventory.summary':
          result = await store.summary();
          break;
        case 'control.plan':
          validator.validateControlObservation(request.params.observation);
          result = planner.plan(request.params.command, request.params.observation);
          if (result.proposal) validator.validateControlProposal(result.proposal);
          break;
        case 'control.receipt.record':
          validator.validateControlReceipt(request.params.receipt);
          planner.assertReceiptBinding(request.params.receipt);
          result = await receiptStore.record(request.params.receipt);
          planner.rememberReceipt(request.params.receipt);
          break;
        case 'control.task.start':
          result = { task: await taskEngine.start(request.params.submissionId, request.params.text) };
          break;
        case 'control.task.get':
          result = { task: await taskEngine.get(request.params.taskId) };
          break;
        case 'control.task.next':
          validator.validateControlObservation(request.params.observation);
          result = await taskEngine.next(
            request.params.taskId,
            request.params.expectedRevision,
            request.params.observation,
          );
          break;
        case 'control.task.step.commit':
          result = await taskEngine.commit(
            request.params.taskId,
            request.params.stepId,
            request.params.expectedRevision,
            request.params.receipt,
          );
          break;
        case 'control.task.cancel':
          result = {
            task: await taskEngine.cancel(
              request.params.taskId,
              request.params.expectedRevision,
              request.params.cancellationId,
            ),
          };
          break;
        case 'provider.status':
          if (providerCoordinator === null) {
            return validator.validateResponse(providerFailure(request, 'PROVIDER_STATE_INVALID'));
          }
          result = providerCoordinator.status();
          break;
        case 'provider.connect.start':
          if (providerCoordinator === null) {
            return validator.validateResponse(providerFailure(request, 'PROVIDER_STATE_INVALID'));
          }
          result = providerCoordinator.connectStart();
          break;
        case 'provider.models.start':
          if (providerCoordinator === null) {
            return validator.validateResponse(providerFailure(request, 'PROVIDER_STATE_INVALID'));
          }
          result = providerCoordinator.modelsStart();
          break;
        case 'provider.model.select':
          if (providerCoordinator === null) {
            return validator.validateResponse(providerFailure(request, 'PROVIDER_STATE_INVALID'));
          }
          result = providerCoordinator.modelSelect(request.params);
          break;
        case 'provider.plan.start':
          if (providerCoordinator === null) {
            return validator.validateResponse(providerFailure(request, 'PROVIDER_STATE_INVALID'));
          }
          result = providerCoordinator.planStart(request.params);
          break;
        case 'provider.operation.get':
          if (providerCoordinator === null) {
            return validator.validateResponse(providerFailure(request, 'PROVIDER_STATE_INVALID'));
          }
          result = providerCoordinator.operationGet(request.params);
          if (request.params.consume === true) {
            const response = validator.validateResponse(success(request, result));
            providerCoordinator.operationCommitConsumption({
              operationId: result.operationId,
              revision: result.revision,
            });
            return response;
          }
          break;
        case 'provider.operation.cancel':
          if (providerCoordinator === null) {
            return validator.validateResponse(providerFailure(request, 'PROVIDER_STATE_INVALID'));
          }
          result = providerCoordinator.operationCancel(request.params);
          break;
        case 'provider.disconnect.start':
          if (providerCoordinator === null) {
            return validator.validateResponse(providerFailure(request, 'PROVIDER_STATE_INVALID'));
          }
          result = providerCoordinator.disconnectStart();
          break;
        case 'provider.account.reset.start':
          if (providerCoordinator === null) {
            return validator.validateResponse(providerFailure(request, 'PROVIDER_STATE_INVALID'));
          }
          result = providerCoordinator.accountResetStart();
          break;
        default:
          throw new HostError('METHOD_NOT_SUPPORTED', 'Native method is not supported.');
      }
      return validator.validateResponse(success(request, result));
    } catch (error) {
      if (error instanceof ProtocolValidationError && SOURCE_METHODS.has(request.method)) {
        const oversized = error.issues.some((issue) => issue.includes('128 KiB protocol limit'));
        return validator.validateResponse(failure(
          request,
          oversized ? 'SOURCE_RESPONSE_TOO_LARGE' : 'SOURCE_RESPONSE_INVALID',
          oversized
            ? 'Local read-only source response is too large.'
            : 'Local read-only source response is invalid.',
        ));
      }
      if (error instanceof ProtocolValidationError && FINANCIAL_METHOD_SET.has(request.method)) {
        const oversized = error.issues.some((issue) =>
          issue.includes('128 KiB protocol limit') || issue.includes('96 KiB card page limit'));
        return validator.validateResponse(financialFailure(
          request,
          oversized ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR',
        ));
      }
      if (error instanceof FinancialSourceBridgeError ||
          error instanceof FinancialBackendSupervisorError) {
        return validator.validateResponse(financialFailure(request, error.code));
      }
      if (error instanceof ProviderCoordinatorError) {
        return validator.validateResponse(providerFailure(request, error.code));
      }
      if (error instanceof StorageError || error instanceof HostError) {
        return validator.validateResponse(failure(request, error.code, error.message));
      }
      const sanitized = sourceFailure(error);
      if (sanitized) {
        return validator.validateResponse(failure(request, sanitized.code, sanitized.message));
      }
      throw error;
    }
  };
}
