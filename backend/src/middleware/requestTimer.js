const PROFILING_ENABLED = process.env.PERF_PROFILING === '1';

function isProfilingEnabled() {
  return PROFILING_ENABLED;
}

// Logs "[perf] METHOD URL status elapsedMs" for each request once the
// response finishes. No-op unless PERF_PROFILING=1.
function requestTimer(req, res, next) {
  if (!PROFILING_ENABLED) {
    return next();
  }

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(
      `[perf] ${req.method} ${req.originalUrl} ${res.statusCode} ${elapsedMs.toFixed(2)}ms`
    );
  });

  next();
}

module.exports = {
  requestTimer,
  isProfilingEnabled
};
