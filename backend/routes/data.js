// Read-only data feed for BI and reporting tools. Every route needs a
// reporting API key; see controllers/dataController.js and docs/DATA-API.md.
//
// Read-only is enforced three times over: only GET is routed here, a
// reporting key is refused by the one public endpoint that writes
// (POST /api/applications), and every query runs in a READ ONLY transaction,
// so PostgreSQL itself rejects a write should one ever be added by mistake.
const express = require('express');
const data = require('../controllers/dataController');
const { requireReportingKey } = require('../middlewares/apiKey');
const { publicLimiter, dataLimiter } = require('../middlewares/rateLimit');
const { fail, oneError, CODES } = require('../utils/errors');

const router = express.Router();

// Controllers are async (PostgreSQL); route rejections to the error handler
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Anything but a read is refused by name, before any key is looked up, rather
// than falling through to a 404 that reads as "wrong address"
const readOnly = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  res.setHeader('Allow', 'GET, HEAD');
  return fail(
    res,
    405,
    oneError(
      'request',
      CODES.METHOD_NOT_ALLOWED,
      'The data API is read-only. Only GET requests are accepted.'
    )
  );
};

// Order matters:
//   readOnly             writes never get further than this
//   publicLimiter        per IP, so guessing keys cannot reach the key lookup
//                        at volume
//   requireReportingKey  no key, a wrong key or a partner-site key stops here
//   dataLimiter          the accepted key's own hourly allowance
router.use(readOnly, publicLimiter, ah(requireReportingKey), dataLimiter);

router.get('/', ah(data.all));
router.get('/:dataset', ah(data.dataset));

module.exports = router;
