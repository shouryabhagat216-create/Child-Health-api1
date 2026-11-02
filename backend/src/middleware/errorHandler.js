const { AppError, NotFoundError } = require('../errors');

function notFoundHandler(req, res, next) {
  next(new NotFoundError('ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} does not exist`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  }

  if (status >= 500) {
    // Log the real error server-side; never leak internals to the client.
    console.error(JSON.stringify({ level: 'error', requestId: req.id, name: err.name, message: err.message }));
  }

  const body = { error: { code, message, requestId: req.id } };
  if (details) body.error.details = details;
  res.status(status).json(body);
}

module.exports = { notFoundHandler, errorHandler };
