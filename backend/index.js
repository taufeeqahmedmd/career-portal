const dotenv = require('dotenv');
dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set. Add it to your environment or .env file.');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const db = require('./db');
const { initSchema } = require('./db/init');
const seed = require('./db/seed');
const { runStartupChecks } = require('./utils/startupChecks');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();

// Behind a reverse proxy every request arrives from the proxy's address, so
// without this every visitor shares one rate-limit bucket: a handful of failed
// logins would lock out the whole office, and the application form would stop
// accepting submissions site-wide after 15 an hour.
// TRUST_PROXY takes the number of proxies in front of this process (1 for a
// single nginx), or a comma-separated list of trusted addresses. Left unset it
// stays off, which is correct when the app is exposed directly.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
  const asNumber = Number(trustProxy);
  app.set(
    'trust proxy',
    Number.isInteger(asNumber) ? asNumber : trustProxy.split(',').map((v) => v.trim())
  );
}

// The admin API is called only by this application's own frontend. ALLOWED_ORIGINS
// (comma-separated) locks it to those origins; unset keeps the previous
// permissive behaviour so existing deployments do not break on upgrade.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);
app.use(
  cors(
    allowedOrigins.length
      ? {
          origin: (origin, callback) => {
            // No Origin header: same-origin, curl, or a server-side call
            if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) {
              return callback(null, true);
            }
            callback(new Error('Not allowed by CORS'));
          },
        }
      : undefined
  )
);

// Baseline response headers. The API serves JSON to a separate frontend, so
// this is deliberately small - no CSP, which belongs with whatever serves HTML.
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

// Last resort for unexpected failures in async controllers
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  // Malformed JSON from express.json() carries status 400
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  // A lost race on a check-then-insert surfaces as a unique violation
  if (err.code === '23505') {
    return res.status(409).json({ error: 'That record already exists.' });
  }
  // A referenced row is still in use elsewhere
  if (err.code === '23503') {
    return res.status(409).json({ error: 'This record is still referenced elsewhere.' });
  }

  console.error('Unhandled error:', err);
  const status = err.status || err.statusCode || 500;
  res
    .status(status)
    .json({ error: status === 500 ? 'Something went wrong. Please try again.' : err.message });
});

const PORT = process.env.PORT || 5001;

async function start() {
  try {
    await initSchema();
    await seed(db);
  } catch (err) {
    console.error('Database initialisation failed:', err.message);
    process.exit(1);
  }
  await runStartupChecks();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (PostgreSQL)`);
  });
}

start();
