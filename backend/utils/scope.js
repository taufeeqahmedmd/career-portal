// Effective data scope for a user.
// {} = unrestricted (no entity/branch assigned - e.g. the Super Admin)
// { group } = whole entity; { group, branch, branchId } = single branch
function scopeFor(user) {
  if (!user) return {};
  const scope = {};
  if (user.school_group) scope.group = user.school_group;
  if (user.branch_id && user.branch_name) {
    scope.group = user.branch_group || scope.group;
    scope.branch = user.branch_name;
    scope.branchId = user.branch_id;
  }
  return scope;
}

module.exports = { scopeFor };
