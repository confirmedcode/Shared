module.exports = class ConfirmedError extends Error {
  constructor (statusCode, confirmedCode, message, error) {
    super(message);
    this.statusCode = statusCode || 500;
    this.confirmedCode = confirmedCode || -1;
    this.message = message || "";
    if (error && error.stack) {
      this.stack = error.stack;
    }
    else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
};