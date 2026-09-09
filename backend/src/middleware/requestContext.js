const { AsyncLocalStorage } = require('async_hooks');
const { v4: uuidv4 } = require('uuid');

const als = new AsyncLocalStorage();

function getRequestContext() {
  return als.getStore() || {};
}

function setRequestContext(fields) {
  const store = als.getStore();
  if (store) {
    Object.assign(store, fields);
  }
}

// Express route pattern (e.g. /api/clients/:id) for low-cardinality labels;
// falls back to the raw path when no route matched.
function getRoutePattern(req) {
  if (!req.route) return req.path;
  const route = `${req.baseUrl || ''}${req.route.path}`;
  return route.length > 1 ? route.replace(/\/$/, '') : route;
}

function requestContext(req, res, next) {
  const requestId = req.headers['x-request-id'] || uuidv4();
  res.setHeader('x-request-id', requestId);
  als.run({ requestId }, next);
}

module.exports = {
  als,
  getRequestContext,
  setRequestContext,
  getRoutePattern,
  requestContext
};
