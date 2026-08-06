const express = require('express');
const multer = require('multer');
const {
  requireAuth,
  requirePermission,
  requirePasswordChanged,
} = require('../middlewares/auth');
const {
  loginLimiter,
  passwordResetLimiter,
  passwordResetRedeemLimiter,
  totpLimiter,
} = require('../middlewares/rateLimit');
const auth = require('../controllers/authController');
const branches = require('../controllers/branchesController');
const openings = require('../controllers/openingsController');
const applications = require('../controllers/applicationsController');
const users = require('../controllers/usersController');
const roles = require('../controllers/rolesController');
const entities = require('../controllers/entitiesController');
const flow = require('../controllers/flowController');
const reports = require('../controllers/reportsController');

const router = express.Router();

// Controllers are async (PostgreSQL); route rejections to the error handler
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// CSV bulk imports are read straight from memory
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});
const uploadCsv = (req, res, next) => {
  csvUpload.single('file')(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'The CSV must be 2 MB or smaller.'
          : 'Could not read the uploaded file.';
      return res.status(400).json({ error: message });
    }
    next();
  });
};

// ---- Unauthenticated ----
router.post('/login', loginLimiter, ah(auth.login));
// Second leg of a two-factor sign-in
router.post('/login/totp', totpLimiter, ah(auth.verifyTotp));
router.post('/forgot-password', passwordResetLimiter, ah(auth.forgotPassword));
router.post('/reset-password', passwordResetRedeemLimiter, ah(auth.resetPassword));

router.use(ah(requireAuth));

// ---- Signed in, but possibly still on the initial password ----
router.get('/me', auth.me);
router.post('/change-password', ah(auth.changePassword));

// Everything past this point needs a password the user has chosen themselves
router.use(requirePasswordChanged);

// Two-factor switches - super admin territory
router.get('/security', requirePermission('security.manage'), ah(auth.getSecuritySettings));
router.put('/security', requirePermission('security.manage'), ah(auth.updateSecuritySettings));
router.patch('/users/:id/totp', requirePermission('security.manage'), ah(users.setTotp));

// Entity + branch lists are reference data used by several forms - any authenticated admin
router.get('/entities', ah(entities.list));
router.post('/entities', requirePermission('entities.manage'), ah(entities.create));
router.put('/entities/:id', requirePermission('entities.manage'), ah(entities.update));
router.delete('/entities/:id', requirePermission('entities.manage'), ah(entities.remove));

router.get('/branches', ah(branches.list));
router.post('/branches', requirePermission('branches.manage'), ah(branches.create));
router.put('/branches/:id', requirePermission('branches.manage'), ah(branches.update));
router.delete('/branches/:id', requirePermission('branches.manage'), ah(branches.remove));

router.get('/openings', requirePermission('openings.view'), ah(openings.listAll));
// Bulk import needs the area's own permission *and* the separate import grant
router.post(
  '/openings/import',
  requirePermission('openings.manage'),
  requirePermission('data.import'),
  uploadCsv,
  ah(openings.importCsv)
);
router.post('/openings', requirePermission('openings.manage'), ah(openings.create));
router.put('/openings/:id', requirePermission('openings.manage'), ah(openings.update));

router.get('/applications', requirePermission('applications.view'), ah(applications.list));
router.get('/applications/stats', requirePermission('applications.view'), ah(applications.stats));
// Exports need a one-time code approved by a super admin
router.post(
  '/applications/export/request-otp',
  requirePermission('applications.export'),
  ah(applications.requestExportOtp)
);
router.get(
  '/applications/export',
  requirePermission('applications.export'),
  ah(applications.exportCsv)
);
router.get(
  '/applications/assignees',
  requirePermission('applications.view'),
  ah(applications.listAssignees)
);
// Registered after /stats, /export and /assignees so ':id' cannot shadow them
router.get('/applications/:id', requirePermission('applications.view'), ah(applications.getOne));
// The only way to read a resume: authenticated, scope-checked, never public
router.get(
  '/applications/:id/resume',
  requirePermission('applications.view'),
  ah(applications.getResume)
);
// Hiring pipeline updates (screening, interview rounds, role suggestion).
// These write candidate decisions, so they need the manage grant - viewing is
// not enough.
router.put(
  '/applications/:id/screening',
  requirePermission('applications.manage'),
  ah(applications.updateScreening)
);
router.put(
  '/applications/:id/rounds/:roundNo',
  requirePermission('applications.manage'),
  ah(applications.updateRound)
);
router.put(
  '/applications/:id/suggestion',
  requirePermission('applications.manage'),
  ah(applications.updateSuggestion)
);

router.get('/users', requirePermission('users.manage'), ah(users.list));
router.post(
  '/users/import',
  requirePermission('users.manage'),
  requirePermission('data.import'),
  uploadCsv,
  ah(users.importCsv)
);
router.post('/users', requirePermission('users.manage'), ah(users.create));
router.patch('/users/:id', requirePermission('users.manage'), ah(users.setActive));
router.put('/users/:id', requirePermission('roles.manage'), ah(users.update));

// Hiring flow configuration (dropdown values for the pipeline)
router.get('/flow-options/active', requirePermission('applications.view'), ah(flow.listActive));
router.get('/flow-options', requirePermission('flow.manage'), ah(flow.list));
router.post(
  '/flow-options/import',
  requirePermission('flow.manage'),
  requirePermission('data.import'),
  uploadCsv,
  ah(flow.importCsv)
);
router.post('/flow-options', requirePermission('flow.manage'), ah(flow.create));
router.put('/flow-options/:id', requirePermission('flow.manage'), ah(flow.update));
router.delete('/flow-options/:id', requirePermission('flow.manage'), ah(flow.remove));

router.get('/roles/catalog', requirePermission('roles.manage'), roles.catalog);
router.get('/roles', requirePermission('users.manage'), ah(roles.list));
router.post('/roles', requirePermission('roles.manage'), ah(roles.create));
router.put('/roles/:id', requirePermission('roles.manage'), ah(roles.update));
router.delete('/roles/:id', requirePermission('roles.manage'), ah(roles.remove));

// Instance-wide report. Read-only and scoped to whatever the caller can see.
router.get('/reports', requirePermission('reports.view'), ah(reports.summary));
router.get('/reports/export', requirePermission('reports.view'), ah(reports.exportCsv));

module.exports = router;
