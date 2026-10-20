import { randomUUID } from 'node:crypto';

import {
  CONTROL_CATALOG_VERSION,
  PROVIDER_ERROR_MESSAGES,
} from '../../../contracts/wts-foundation.mjs';

import { CONTROL_PLANNING_CATALOG } from '../task-compiler.mjs';
import { ModelsClient } from './models-client.mjs';
import { OAuthSession } from './oauth-session.mjs';
import { OpenIdVerifier } from './openid-verifier.mjs';
import { PlanningClient } from './planning-client.mjs';
import { RegistrationStore } from './registration-store.mjs';
import { ResponsesClient } from './responses-client.mjs';
import { createAuthorizationBrowserOpener } from './browser-opener.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MODEL_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_SNAPSHOT_BYTES = 96 * 1024;
const CONNECT_FAILURE_CODES = new Map([
  ['OPENAI_OAUTH_EXCHANGE_FAILED', 'PROVIDER_CONNECT_EXCHANGE_FAILED'],
  ['OPENAI_OAUTH_EXCHANGE_DEADLINE_EXCEEDED', 'PROVIDER_CONNECT_EXCHANGE_TIMEOUT'],
  ['OPENAI_OAUTH_TOKEN_HTTP_ERROR', 'PROVIDER_CONNECT_TOKEN_REJECTED'],
  ['OPENAI_OAUTH_TOKEN_RESPONSE_INVALID', 'PROVIDER_CONNECT_TOKEN_RESPONSE_INVALID'],
  ['OPENAI_OAUTH_IDENTITY_INVALID', 'PROVIDER_CONNECT_IDENTITY_INVALID'],
  ['OPENAI_OAUTH_ACCOUNT_MISMATCH', 'PROVIDER_CONNECT_ACCOUNT_MISMATCH'],
  ['OPENAI_OAUTH_BIND_FAILED', 'PROVIDER_CONNECT_REGISTRATION_FAILED'],
  ['OPENAI_OAUTH_TOKEN_ACTIVATION_FAILED', 'PROVIDER_CONNECT_SESSION_FAILED'],
  ['OPENAI_OAUTH_DEADLINE_EXCEEDED', 'PROVIDER_CONNECT_TIMEOUT'],
]);
const MODELS_FAILURE_CODES = new Map([
  ['OPENAI_MODELS_AUTH_REQUIRED', 'PROVIDER_MODELS_AUTH_REQUIRED'],
  ['OPENAI_MODELS_ACCESS_DENIED', 'PROVIDER_MODELS_ACCESS_DENIED'],
  ['OPENAI_MODELS_RATE_LIMITED', 'PROVIDER_MODELS_RATE_LIMITED'],
  ['OPENAI_MODELS_SERVICE_UNAVAILABLE', 'PROVIDER_MODELS_SERVICE_UNAVAILABLE'],
  ['OPENAI_MODELS_HTTP_ERROR', 'PROVIDER_MODELS_HTTP_FAILED'],
  ['OPENAI_MODELS_DEADLINE_EXCEEDED', 'PROVIDER_MODELS_TIMEOUT'],
  ['OPENAI_MODELS_NETWORK_ERROR', 'PROVIDER_MODELS_NETWORK_FAILED'],
  ['OPENAI_MODELS_TOKEN_UNAVAILABLE', 'PROVIDER_MODELS_SESSION_UNAVAILABLE'],
  ['OPENAI_MODELS_TOKEN_INVALID', 'PROVIDER_MODELS_SESSION_UNAVAILABLE'],
  ['OPENAI_MODELS_BODY_TOO_LARGE', 'PROVIDER_MODELS_RESPONSE_TOO_LARGE'],
  ['OPENAI_MODELS_CONTENT_TYPE_INVALID', 'PROVIDER_MODELS_RESPONSE_FORMAT_INVALID'],
  ['OPENAI_MODELS_JSON_INVALID', 'PROVIDER_MODELS_RESPONSE_FORMAT_INVALID'],
  ['OPENAI_MODELS_UTF8_INVALID', 'PROVIDER_MODELS_RESPONSE_FORMAT_INVALID'],
  ['OPENAI_MODELS_BODY_INVALID', 'PROVIDER_MODELS_RESPONSE_FORMAT_INVALID'],
  ['OPENAI_MODELS_BODY_READ_ERROR', 'PROVIDER_MODELS_RESPONSE_READ_FAILED'],
  ['OPENAI_MODELS_PAYLOAD_INVALID', 'PROVIDER_MODELS_RESPONSE_SCHEMA_INVALID'],
  ['OPENAI_MODELS_ENTRY_INVALID', 'PROVIDER_MODELS_MODEL_METADATA_INVALID'],
  ['OPENAI_MODELS_REDIRECT_REJECTED', 'PROVIDER_MODELS_REDIRECT_REJECTED'],
  ['OPENAI_MODELS_COUNT_EXCEEDED', 'PROVIDER_MODELS_COUNT_EXCEEDED'],
]);

export class ProviderCoordinatorError extends Error {
  constructor(code, message = PROVIDER_ERROR_MESSAGES[code] ?? code) {
    super(message);
    this.name = 'ProviderCoordinatorError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ProviderCoordinatorError(code, message);
}

function safeClone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

export class ProviderCoordinator {
  #dataRoot;
  #registrationStore;
  #openIdVerifier;
  #openBrowser;
  #fetchImpl;
  #nowImpl;
  #randomUuidImpl;
  #createOAuthSession;
  #createModelsClient;
  #createResponsesClient;
  #createPlanningClient;
  #catalog;
  #catalogVersion;

  #connection = 'signed-out';
  #catalogState = 'unavailable';
  #selectedModel = null;
  #models = [];

  #tokenSession = null;
  #responsesClient = null;
  #planningClient = null;

  #activeJob = null;
  #terminalJob = null;
  #generation = 0;

  constructor({
    dataRoot,
    registrationStore,
    openIdVerifier,
    openBrowser,
    fetchImpl = fetch,
    nowImpl = Date.now,
    randomUuidImpl = () => randomUUID(),
    createOAuthSession = (options) => new OAuthSession(options),
    createModelsClient = (options) => new ModelsClient(options),
    createResponsesClient = (options) => new ResponsesClient(options),
    createPlanningClient = (options) => new PlanningClient(options),
    planningCatalog = CONTROL_PLANNING_CATALOG,
    catalogVersion = CONTROL_CATALOG_VERSION,
  } = {}) {
    this.#dataRoot = dataRoot;
    this.#registrationStore = registrationStore ?? new RegistrationStore({ dataRoot });
    this.#openIdVerifier = openIdVerifier ?? new OpenIdVerifier({ fetchImpl, now: nowImpl });
    this.#openBrowser = openBrowser ?? createAuthorizationBrowserOpener();
    this.#fetchImpl = fetchImpl;
    this.#nowImpl = nowImpl;
    this.#randomUuidImpl = randomUuidImpl;
    this.#createOAuthSession = createOAuthSession;
    this.#createModelsClient = createModelsClient;
    this.#createResponsesClient = createResponsesClient;
    this.#createPlanningClient = createPlanningClient;
    this.#catalog = planningCatalog;
    this.#catalogVersion = catalogVersion;
  }

  status() {
    this.#syncTokenState();
    return Object.freeze({
      provider: 'openai-chatgpt-siwc-v1',
      connection: this.#connection,
      accountResetAvailable: this.#connection === 'signed-out'
        && this.#activeJob === null
        && (this.#terminalJob === null || this.#terminalJob.consumed === true),
      catalog: this.#catalogState,
      selectedModel: this.#selectedModel ? safeClone(this.#selectedModel) : null,
      operation: this.#getPublicOperationSnapshot(),
    });
  }

  #syncTokenState() {
    if (this.#tokenSession && !this.#tokenSession.active) {
      this.#tokenSession = null;
      this.#connection = 'signed-out';
      this.#catalogState = 'unavailable';
      this.#selectedModel = null;
      this.#responsesClient = null;
      this.#planningClient = null;
      this.#models = [];
    }
  }

  #getPublicOperationSnapshot() {
    if (this.#activeJob) {
      return Object.freeze({
        operationId: this.#activeJob.operationId,
        kind: this.#activeJob.kind,
        state: this.#activeJob.state,
        revision: this.#activeJob.revision,
        cancellable: this.#activeJob.cancellable,
      });
    }
    if (this.#terminalJob && !this.#terminalJob.consumed) {
      return Object.freeze({
        operationId: this.#terminalJob.operationId,
        kind: this.#terminalJob.kind,
        state: this.#terminalJob.state,
        revision: this.#terminalJob.revision,
        cancellable: false,
      });
    }
    return null;
  }

  #assertCanStart() {
    this.#syncTokenState();
    if (this.#activeJob) {
      fail('PROVIDER_BUSY');
    }
    if (this.#terminalJob && !this.#terminalJob.consumed) {
      fail('PROVIDER_PREVIOUS_RESULT_PENDING');
    }
  }

  #buildSnapshot(job) {
    const snapshot = {
      operationId: job.operationId,
      kind: job.kind,
      state: job.state,
      revision: job.revision,
      cancellable: job.cancellable,
      result: job.result ?? null,
      error: job.error ?? null,
    };
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_SNAPSHOT_BYTES) {
      fail('PROVIDER_OPERATION_CONFLICT');
    }
    return Object.freeze(snapshot);
  }

  connectStart() {
    this.#assertCanStart();
    if (this.#connection !== 'signed-out') {
      fail('PROVIDER_STATE_INVALID');
    }

    const operationId = this.#randomUuidImpl();
    const generation = this.#generation;
    const controller = new AbortController();

    this.#connection = 'connecting';
    this.#activeJob = {
      operationId,
      kind: 'connect',
      state: 'running',
      revision: 1,
      cancellable: true,
      cancelFn: () => controller.abort('cancelled'),
      abortController: controller,
    };

    const oauthSession = this.#createOAuthSession({
      registrationStore: this.#registrationStore,
      openIdVerifier: this.#openIdVerifier,
      openBrowser: this.#openBrowser,
      fetchImpl: this.#fetchImpl,
      now: this.#nowImpl,
    });
    this.#activeJob.cancelFn = () => {
      controller.abort('cancelled');
      try { oauthSession.cancel?.(); } catch {}
    };

    (async () => {
      try {
        const tokenSession = await oauthSession.connect({ signal: controller.signal });
        if (this.#generation !== generation || this.#activeJob?.operationId !== operationId) {
          try { tokenSession.shutdown(); } catch {}
          return;
        }
        if (this.#finishAcceptedCancellation({ generation, operationId, tokenSession })) return;
        this.#tokenSession = tokenSession;
        this.#connection = 'connected';
        this.#catalogState = 'not-loaded';
        this.#publishTerminal({
          operationId,
          kind: 'connect',
          state: 'succeeded',
          revision: this.#activeJob.revision + 1,
          result: { connection: 'connected' },
          error: null,
        });
      } catch (err) {
        if (this.#generation !== generation || this.#activeJob?.operationId !== operationId) return;
        if (this.#finishAcceptedCancellation({ generation, operationId })) return;
        this.#connection = 'signed-out';
        const isCancel = controller.signal.aborted || err?.code === 'OPENAI_OAUTH_CANCELLED';
        const code = isCancel ? 'PROVIDER_CONNECT_CANCELLED'
          : CONNECT_FAILURE_CODES.get(err?.code) ?? 'PROVIDER_CONNECT_FAILED';
        this.#publishTerminal({
          operationId,
          kind: 'connect',
          state: isCancel ? 'cancelled' : 'failed',
          revision: this.#activeJob.revision + 1,
          result: null,
          error: { code, message: PROVIDER_ERROR_MESSAGES[code] },
        });
      }
    })();

    return this.#buildSnapshot(this.#activeJob);
  }

  modelsStart() {
    this.#assertCanStart();
    if (this.#connection !== 'connected' || !this.#tokenSession?.active) {
      fail('PROVIDER_STATE_INVALID');
    }

    const operationId = this.#randomUuidImpl();
    const generation = this.#generation;
    const controller = new AbortController();

    this.#catalogState = 'loading';
    this.#selectedModel = null;
    this.#responsesClient = null;
    this.#planningClient = null;
    this.#models = [];

    this.#activeJob = {
      operationId,
      kind: 'models',
      state: 'running',
      revision: 1,
      cancellable: true,
      cancelFn: () => controller.abort('cancelled'),
      abortController: controller,
    };

    const client = this.#createModelsClient({
      accessToken: (opts) => this.#tokenSession.accessToken(opts),
      fetchImpl: this.#fetchImpl,
    });
    this.#activeJob.cancelFn = () => {
      controller.abort('cancelled');
      try { client.cancel?.(); } catch {}
    };

    (async () => {
      try {
        const res = await client.list({ signal: controller.signal });
        if (this.#generation !== generation || this.#activeJob?.operationId !== operationId) return;
        if (this.#finishAcceptedCancellation({ generation, operationId })) return;
        this.#models = res;
        this.#catalogState = 'ready';
        this.#publishTerminal({
          operationId,
          kind: 'models',
          state: 'succeeded',
          revision: this.#activeJob.revision + 1,
          result: { models: safeClone(res) },
          error: null,
        });
      } catch (err) {
        if (this.#generation !== generation || this.#activeJob?.operationId !== operationId) return;
        if (this.#finishAcceptedCancellation({ generation, operationId })) return;
        if (err?.code === 'OPENAI_MODELS_AUTH_REQUIRED') {
          try { this.#tokenSession.shutdown(); } catch {}
          this.#tokenSession = null;
          this.#connection = 'signed-out';
          this.#catalogState = 'unavailable';
        } else {
          this.#syncTokenState();
          this.#catalogState = this.#connection === 'connected' ? 'not-loaded' : 'unavailable';
        }
        const isCancel = controller.signal.aborted || err?.code === 'OPENAI_MODELS_CANCELLED';
        const code = isCancel ? 'PROVIDER_MODELS_CANCELLED'
          : MODELS_FAILURE_CODES.get(err?.code) ?? 'PROVIDER_MODELS_FAILED';
        this.#publishTerminal({
          operationId,
          kind: 'models',
          state: isCancel ? 'cancelled' : 'failed',
          revision: this.#activeJob.revision + 1,
          result: null,
          error: { code, message: PROVIDER_ERROR_MESSAGES[code] },
        });
      }
    })();

    return this.#buildSnapshot(this.#activeJob);
  }

  modelSelect({ slug } = {}) {
    this.#assertCanStart();
    if (this.#connection !== 'connected' || !this.#tokenSession?.active) {
      fail('PROVIDER_STATE_INVALID');
    }
    if (this.#catalogState !== 'ready') {
      fail('PROVIDER_MODEL_CATALOG_REQUIRED');
    }
    if (typeof slug !== 'string' || !MODEL_SLUG_PATTERN.test(slug)) {
      fail('PROVIDER_MODEL_INVALID');
    }
    const target = this.#models.find((m) => m.slug === slug);
    if (!target) {
      fail('PROVIDER_MODEL_INVALID');
    }

    this.#selectedModel = {
      slug: target.slug,
      displayName: target.displayName,
      compatibility: 'untested',
    };

    this.#responsesClient = this.#createResponsesClient({
      model: target.slug,
      accessToken: (opts) => this.#tokenSession.accessToken(opts),
      fetchImpl: this.#fetchImpl,
    });
    this.#planningClient = this.#createPlanningClient({
      responsesClient: this.#responsesClient,
      catalog: this.#catalog,
    });

    return this.status();
  }

  planStart({ submissionId, text } = {}) {
    this.#assertCanStart();
    if (this.#connection !== 'connected' || !this.#tokenSession?.active) {
      fail('PROVIDER_STATE_INVALID');
    }
    if (!this.#selectedModel || !this.#planningClient) {
      fail('PROVIDER_MODEL_NOT_SELECTED');
    }
    if (typeof submissionId !== 'string' || !UUID_PATTERN.test(submissionId)) {
      throw new TypeError('submissionId 형식이 올바르지 않습니다.');
    }
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new TypeError('text를 입력해 주세요.');
    }

    const operationId = this.#randomUuidImpl();
    const generation = this.#generation;
    const controller = new AbortController();
    const planningClient = this.#planningClient;

    this.#activeJob = {
      operationId,
      kind: 'plan',
      state: 'running',
      revision: 1,
      cancellable: true,
      cancelFn: () => {
        controller.abort('cancelled');
        try { planningClient.cancel(); } catch {}
      },
      abortController: controller,
    };

    (async () => {
      try {
        const plan = await planningClient.plan(text, { signal: controller.signal });
        if (this.#generation !== generation || this.#activeJob?.operationId !== operationId) return;
        if (this.#finishAcceptedCancellation({ generation, operationId })) return;

        if (this.#selectedModel) {
          this.#selectedModel.compatibility = 'completed';
        }
        this.#publishTerminal({
          operationId,
          kind: 'plan',
          state: 'succeeded',
          revision: this.#activeJob.revision + 1,
          result: {
            submissionId,
            catalogVersion: this.#catalogVersion,
            assistantText: plan.assistantText,
            proposal: plan.proposal ? safeClone(plan.proposal) : null,
          },
          error: null,
        });
      } catch (err) {
        if (this.#generation !== generation || this.#activeJob?.operationId !== operationId) return;
        if (this.#finishAcceptedCancellation({ generation, operationId })) return;
        const isSensitive = err?.code === 'OPENAI_PLANNING_INPUT_SENSITIVE';
        const isCancel = controller.signal.aborted || err?.code === 'OPENAI_RESPONSE_CANCELLED';
        let code = 'PROVIDER_PLAN_FAILED';
        let state = 'failed';
        if (isSensitive) {
          code = 'PROVIDER_PLAN_INPUT_SENSITIVE';
        } else if (isCancel) {
          code = 'PROVIDER_PLAN_CANCELLED';
          state = 'cancelled';
        }
        this.#publishTerminal({
          operationId,
          kind: 'plan',
          state,
          revision: this.#activeJob.revision + 1,
          result: null,
          error: { code, message: PROVIDER_ERROR_MESSAGES[code] },
        });
      }
    })();

    return this.#buildSnapshot(this.#activeJob);
  }

  disconnectStart() {
    this.#assertCanStart();
    if (this.#connection !== 'connected') {
      fail('PROVIDER_STATE_INVALID');
    }

    const operationId = this.#randomUuidImpl();
    const generation = this.#generation;
    const tokenSession = this.#tokenSession;

    this.#connection = 'disconnecting';
    this.#tokenSession = null;
    this.#catalogState = 'unavailable';
    this.#selectedModel = null;
    this.#responsesClient = null;
    this.#planningClient = null;
    this.#models = [];

    this.#activeJob = {
      operationId,
      kind: 'disconnect',
      state: 'running',
      revision: 1,
      cancellable: false,
      cancelFn: null,
      abortController: null,
    };

    (async () => {
      let revocation = 'unconfirmed';
      try {
        if (tokenSession) {
          revocation = await tokenSession.disconnect();
        }
        if (this.#generation !== generation || this.#activeJob?.operationId !== operationId) return;
        this.#connection = 'signed-out';
        this.#publishTerminal({
          operationId,
          kind: 'disconnect',
          state: 'succeeded',
          revision: this.#activeJob.revision + 1,
          result: { connection: 'signed-out', revocation },
          error: null,
        });
      } catch {
        if (this.#generation !== generation || this.#activeJob?.operationId !== operationId) return;
        this.#connection = 'signed-out';
        const code = 'PROVIDER_DISCONNECT_FAILED';
        this.#publishTerminal({
          operationId,
          kind: 'disconnect',
          state: 'failed',
          revision: this.#activeJob.revision + 1,
          result: null,
          error: { code, message: PROVIDER_ERROR_MESSAGES[code] },
        });
      }
    })();

    return this.#buildSnapshot(this.#activeJob);
  }

  accountResetStart() {
    this.#assertCanStart();
    if (this.#connection !== 'signed-out') {
      fail('PROVIDER_STATE_INVALID');
    }

    const operationId = this.#randomUuidImpl();
    const generation = this.#generation;

    this.#connection = 'resetting';
    this.#activeJob = {
      operationId,
      kind: 'account-reset',
      state: 'running',
      revision: 1,
      cancellable: false,
      cancelFn: null,
      abortController: null,
    };

    (async () => {
      try {
        let registrationOutcome = 'already-empty';
        let metadata;
        try {
          metadata = await this.#registrationStore.read();
        } catch (readErr) {
          if (readErr?.code === 'OPENAI_REGISTRATION_NOT_FOUND') {
            metadata = null;
          } else {
            throw readErr;
          }
        }

        if (metadata && metadata.issuedClientId) {
          await this.#registrationStore.reset({
            expectedIssuedClientId: metadata.issuedClientId,
            expectedAccountBindingSha256: metadata.accountBindingSha256,
          });
          registrationOutcome = 'reset';
        }

        if (this.#generation !== generation || this.#activeJob?.operationId !== operationId) return;
        this.#connection = 'signed-out';
        this.#publishTerminal({
          operationId,
          kind: 'account-reset',
          state: 'succeeded',
          revision: this.#activeJob.revision + 1,
          result: { connection: 'signed-out', registration: registrationOutcome },
          error: null,
        });
      } catch {
        if (this.#generation !== generation || this.#activeJob?.operationId !== operationId) return;
        this.#connection = 'signed-out';
        const code = 'PROVIDER_ACCOUNT_RESET_FAILED';
        this.#publishTerminal({
          operationId,
          kind: 'account-reset',
          state: 'failed',
          revision: this.#activeJob.revision + 1,
          result: null,
          error: { code, message: PROVIDER_ERROR_MESSAGES[code] },
        });
      }
    })();

    return this.#buildSnapshot(this.#activeJob);
  }

  #publishTerminal({ operationId, kind, state, revision, result, error }) {
    const cancellationId = this.#activeJob?.operationId === operationId
      ? this.#activeJob.cancellationId
      : undefined;
    this.#terminalJob = {
      operationId,
      kind,
      state,
      revision,
      cancellable: false,
      result,
      error,
      consumed: false,
      cancellationId,
    };
    this.#activeJob = null;
  }

  #finishAcceptedCancellation({ generation, operationId, tokenSession = null }) {
    const job = this.#activeJob;
    if (this.#generation !== generation || job?.operationId !== operationId ||
        job.state !== 'cancelling' || typeof job.cancellationId !== 'string') {
      return false;
    }

    if (tokenSession) {
      try { tokenSession.shutdown(); } catch {}
    }
    if (job.kind === 'connect') {
      this.#tokenSession = null;
      this.#connection = 'signed-out';
      this.#catalogState = 'unavailable';
      this.#selectedModel = null;
      this.#responsesClient = null;
      this.#planningClient = null;
      this.#models = [];
    } else if (job.kind === 'models') {
      this.#syncTokenState();
      if (this.#connection === 'connected') {
        this.#catalogState = 'not-loaded';
      }
    }

    const code = {
      connect: 'PROVIDER_CONNECT_CANCELLED',
      models: 'PROVIDER_MODELS_CANCELLED',
      plan: 'PROVIDER_PLAN_CANCELLED',
    }[job.kind];
    this.#publishTerminal({
      operationId,
      kind: job.kind,
      state: 'cancelled',
      revision: job.revision + 1,
      result: null,
      error: { code, message: PROVIDER_ERROR_MESSAGES[code] },
    });
    return true;
  }

  operationGet({ operationId, consume = false } = {}) {
    if (this.#activeJob && this.#activeJob.operationId === operationId) {
      if (consume === true) {
        fail('PROVIDER_OPERATION_NOT_TERMINAL');
      }
      return this.#buildSnapshot(this.#activeJob);
    }
    if (this.#terminalJob && this.#terminalJob.operationId === operationId) {
      return this.#buildSnapshot(this.#terminalJob);
    }
    fail('PROVIDER_OPERATION_NOT_FOUND');
  }

  operationCommitConsumption({ operationId, revision } = {}) {
    if (!this.#terminalJob || this.#terminalJob.operationId !== operationId) {
      fail('PROVIDER_OPERATION_NOT_FOUND');
    }
    if (this.#terminalJob.revision !== revision) {
      fail('PROVIDER_OPERATION_CONFLICT');
    }
    this.#terminalJob.consumed = true;
  }

  operationCancel({ operationId, expectedRevision, cancellationId } = {}) {
    if (!this.#activeJob || this.#activeJob.operationId !== operationId) {
      if (this.#terminalJob && this.#terminalJob.operationId === operationId) {
        if (this.#terminalJob.cancellationId !== undefined) {
          if (this.#terminalJob.cancellationId === cancellationId) {
            return this.#buildSnapshot(this.#terminalJob);
          }
          fail('PROVIDER_OPERATION_CONFLICT');
        }
        fail('PROVIDER_OPERATION_NOT_CANCELLABLE');
      }
      fail('PROVIDER_OPERATION_NOT_FOUND');
    }
    if (!this.#activeJob.cancellable) {
      fail('PROVIDER_OPERATION_NOT_CANCELLABLE');
    }

    if (this.#activeJob.state === 'cancelling') {
      if (this.#activeJob.cancellationId === cancellationId) {
        return this.#buildSnapshot(this.#activeJob);
      }
      fail('PROVIDER_OPERATION_CONFLICT');
    }

    if (this.#activeJob.revision !== expectedRevision) {
      fail('PROVIDER_OPERATION_CONFLICT');
    }

    this.#activeJob.revision += 1;
    this.#activeJob.state = 'cancelling';
    this.#activeJob.cancellationId = cancellationId;
    if (typeof this.#activeJob.cancelFn === 'function') {
      this.#activeJob.cancelFn();
    }
    return this.#buildSnapshot(this.#activeJob);
  }

  shutdown() {
    this.#generation += 1;
    if (this.#activeJob && typeof this.#activeJob.cancelFn === 'function') {
      try { this.#activeJob.cancelFn(); } catch {}
    }
    if (this.#tokenSession) {
      try { this.#tokenSession.shutdown(); } catch {}
      this.#tokenSession = null;
    }
    this.#connection = 'signed-out';
    this.#catalogState = 'unavailable';
    this.#selectedModel = null;
    this.#responsesClient = null;
    this.#planningClient = null;
    this.#activeJob = null;
    this.#terminalJob = null;
  }
}
