export class HostError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'HostError';
    this.code = code;
  }
}

export class StorageError extends HostError {
  constructor(code, message, options = {}) {
    super(code, message, options);
    this.name = 'StorageError';
  }
}
