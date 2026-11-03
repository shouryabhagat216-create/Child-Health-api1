// Application errors carry an HTTP status and a machine-readable code,
// so the error handler can turn them into consistent JSON responses.
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

class NotFoundError extends AppError {
  constructor(code, message) {
    super(404, code, message);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHENTICATED', message);
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(409, 'DUPLICATE_RESOURCE', message);
  }
}

class ForbiddenError extends AppError {
  constructor(code, message) {
    super(403, code, message);
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
};
