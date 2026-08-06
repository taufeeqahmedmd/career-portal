// Capability catalog the application exposes. Roles are sets of these keys.
// '*' on a role grants everything (reserved for the system Super Admin role).
const PERMISSIONS = [
  { key: 'applications.view', label: 'View applications' },
  // Writing to the hiring pipeline - screening, interview rounds, referrals,
  // role suggestions. Separate from view so a reporting-only role really is
  // read-only.
  { key: 'applications.manage', label: 'Update the hiring pipeline' },
  { key: 'applications.export', label: 'Export applications (CSV)' },
  { key: 'openings.view', label: 'View job openings' },
  { key: 'openings.manage', label: 'Add & edit job openings' },
  { key: 'branches.manage', label: 'Manage branches' },
  { key: 'entities.manage', label: 'Manage entities (school groups)' },
  { key: 'users.manage', label: 'Manage users (within scope)' },
  { key: 'roles.manage', label: 'Manage roles & assign roles to users' },
  { key: 'flow.manage', label: 'Manage hiring flow configuration' },
  // Bulk CSV upload is granted separately: it is a fast way to create a lot of
  // records at once, so it is never implied by the matching "manage" permission
  { key: 'data.import', label: 'Bulk import from CSV' },
  { key: 'security.manage', label: 'Manage two-factor authentication' },
  // The instance-wide report: accounts, entities, vacancies, intake and who has
  // been working the pipeline. Read-only, and scoped like everything else - but
  // it is a broad view, so it is granted deliberately rather than implied by
  // any single "view" permission.
  { key: 'reports.view', label: 'View reports' },
];

const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

function can(user, permission) {
  const perms = user?.permissions || [];
  return perms.includes('*') || perms.includes(permission);
}

module.exports = { PERMISSIONS, PERMISSION_KEYS, can };
