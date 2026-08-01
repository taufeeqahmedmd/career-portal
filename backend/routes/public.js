const express = require('express');
const multer = require('multer');
const openings = require('../controllers/openingsController');
const branches = require('../controllers/branchesController');
const applications = require('../controllers/applicationsController');
const entities = require('../controllers/entitiesController');
const { applyLimiter, publicLimiter } = require('../middlewares/rateLimit');
const { requireCaptcha, isConfigured: captchaConfigured } = require('../utils/turnstile');

const router = express.Router();

// Controllers are async (PostgreSQL); route rejections to the error handler
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Resumes are kept in memory only while they are forwarded to Google Drive
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const uploadResume = (req, res, next) => {
  upload.single('resume')(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Resume must be 5 MB or smaller.'
          : 'Resume upload failed. Please try again.';
      return res.status(400).json({ error: message });
    }
    next();
  });
};

router.get('/health', (req, res) => res.json({ ok: true }));
// Lets the form know whether it has to render the Turnstile widget
router.get('/config', publicLimiter, (req, res) =>
  res.json({ captcha_enabled: captchaConfigured() })
);
router.get('/entities', publicLimiter, ah(entities.publicList));
router.get('/openings', publicLimiter, ah(openings.listPublic));
router.get('/branches', publicLimiter, ah(branches.publicList));
// uploadResume runs first: the captcha token arrives as a multipart field, so
// the body has to be parsed before it can be read
router.post('/applications', applyLimiter, uploadResume, requireCaptcha, ah(applications.create));
// Resumes are NOT served here. They are candidate personal data, and this
// router is public - a filename is the only thing that stood between an
// outsider and someone's CV. Admins read them through the authenticated,
// scope-checked route: GET /api/admin/applications/:id/resume
//
// The path is kept so links stored before this change fail closed and loudly
// rather than 404-ing as if the file were simply missing.
router.use('/files/resumes', (req, res) =>
  res.status(403).json({
    error: 'Resumes are only available to signed-in staff from the admin panel.',
  })
);

module.exports = router;
