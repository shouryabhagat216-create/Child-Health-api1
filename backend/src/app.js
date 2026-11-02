const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { randomUUID } = require('crypto');

const requestId = require('./middleware/requestId');
const requestLogger = require('./middleware/requestLogger');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { createChildService } = require('./services/childService');
const { createReminderService } = require('./services/reminderService');
const { healthRouter } = require('./routes/health');
const { childrenRouter } = require('./routes/children');
const { remindersRouter } = require('./routes/reminders');

// App factory: dependencies are injected so tests can use an in-memory repository
// and a fixed id generator (needed to test the duplicate-id check).
function createApp({ repo, generateId = randomUUID, logRequests = true }) {
  const app = express();

  app.use(requestId);
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));
  if (logRequests) app.use(requestLogger);

  const childService = createChildService({ repo, generateId });
  const reminderService = createReminderService({ repo });

  app.use('/health', healthRouter({ repo }));
  app.use('/children', childrenRouter({ childService }));
  app.use('/reminders', remindersRouter({ reminderService }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
