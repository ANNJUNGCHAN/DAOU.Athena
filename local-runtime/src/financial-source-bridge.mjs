import {
  FINANCIAL_ERROR_MESSAGES,
  FINANCIAL_METHODS,
} from '../../contracts/wts-foundation.mjs';

import { FinancialBackendSupervisorError } from './financial-backend-supervisor.mjs';

export class FinancialSourceBridgeError extends Error {
  constructor(code, message = FINANCIAL_ERROR_MESSAGES[code], options = {}) {
    super(message, options);
    this.name = 'FinancialSourceBridgeError';
    this.code = code;
  }
}

export class FinancialSourceBridge {
  #supervisor;

  constructor(supervisor) {
    if (!supervisor || typeof supervisor.request !== 'function') {
      throw new FinancialSourceBridgeError('INTERNAL_ERROR');
    }
    this.#supervisor = supervisor;
  }

  async execute(method, params, options = {}) {
    if (!FINANCIAL_METHODS.includes(method)) {
      throw new FinancialSourceBridgeError('REQUEST_INVALID');
    }
    try {
      return await this.#supervisor.request(method, params, options);
    } catch (error) {
      if (error instanceof FinancialBackendSupervisorError) {
        throw new FinancialSourceBridgeError(error.code, undefined, { cause: error });
      }
      throw new FinancialSourceBridgeError('INTERNAL_ERROR', undefined, { cause: error });
    }
  }
}
