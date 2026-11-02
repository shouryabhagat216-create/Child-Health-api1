// Structured access log. Deliberately logs no request or response bodies,
// because bodies can contain personal and health-related information.
module.exports = function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    console.log(
      JSON.stringify({
        level: 'info',
        requestId: req.id,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs,
      })
    );
  });
  next();
};
