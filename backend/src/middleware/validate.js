const { ValidationError } = require('../errors');

function formatIssues(issues) {
  return issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    message: issue.message,
  }));
}

// validate('body' | 'params', zodSchema) -> middleware that replaces the
// raw input with the parsed (trimmed, defaulted) data or rejects with 400.
module.exports = function validate(source, schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(new ValidationError('Request validation failed', formatIssues(result.error.issues)));
    }
    req[source] = result.data;
    return next();
  };
};
