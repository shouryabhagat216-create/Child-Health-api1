const { ValidationError } = require('../errors');
const { SCENARIOS } = require('../abdm/constants');

// Reads the optional X-Mock-Scenario header so a tester can trigger gateway failures on demand.
module.exports = function mockScenario(req, res, next) {
  const scenario = req.get('x-mock-scenario') || 'success';
  if (!SCENARIOS.includes(scenario)) {
    return next(
      new ValidationError('Unknown mock scenario', [
        { field: 'X-Mock-Scenario', message: `must be one of: ${SCENARIOS.join(', ')}` },
      ])
    );
  }
  req.mockScenario = scenario;
  return next();
};
