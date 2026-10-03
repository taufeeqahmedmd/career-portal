// Effective data scope for a user.
//
// A user is assigned one or more entities and, optionally, one or more branches
// inside them. The branch list narrows: with no branches the user sees every
// branch of their entities, with branches they see only those.
//
//   {}                          -> unrestricted (e.g. the Super Admin)
//   { groups: [..] }            -> those entities, all branches
//   { groups, branchIds, branches } -> only those branches
//
// `group` / `branch` / `branchId` are the single-value forms, set only when the
// list holds exactly one. They exist for the places that render a scope as
// text; anything that filters data must use the lists.
function scopeFor(user) {
  if (!user) return {};

  // Prefer the multi-scope lists loaded by requireAuth; fall back to the legacy
  // single columns so a user object read straight from `users` still scopes.
  const groups = dedupe(
    user.scope_groups?.length ? user.scope_groups : compact([user.school_group])
  );
  const branchIds = dedupe(
    user.scope_branch_ids?.length ? user.scope_branch_ids : compact([user.branch_id])
  );
  const branches = dedupe(
    user.scope_branches?.length ? user.scope_branches : compact([user.branch_name])
  );
  // Applications and openings key on the branch NAME, which is only unique
  // within an entity - so those tables have to be matched on the pair.
  const branchPairs = user.scope_branch_pairs?.length
    ? user.scope_branch_pairs
    : compact([user.branch_name]).map((name) => ({
        name,
        group: user.branch_group || user.school_group,
      }));

  if (!groups.length && !branchIds.length) return {};

  const scope = { groups, branchIds, branches, branchPairs };
  if (groups.length === 1) scope.group = groups[0];
  if (branches.length === 1) scope.branch = branches[0];
  if (branchIds.length === 1) scope.branchId = branchIds[0];
  return scope;
}

// True when the user is confined to named branches rather than whole entities
const isBranchScoped = (scope) => !!scope.branchIds?.length;

// True when the user is confined at all
const isScoped = (scope) => !!(scope.groups?.length || scope.branchIds?.length);

// `col IN (?, ?, ?)` for a list of scope values.
function inList(col, values = []) {
  return { sql: `${col} IN (${values.map(() => '?').join(', ')})`, params: [...values] };
}

// `(branchCol, groupCol) IN ((?, ?), (?, ?))` - a row-value IN, so a branch
// name can never match against the wrong entity.
function inPairs(branchCol, groupCol, pairs = []) {
  return {
    sql: `(${branchCol}, ${groupCol}) IN (${pairs.map(() => '(?, ?)').join(', ')})`,
    params: pairs.flatMap((p) => [p.name, p.group]),
  };
}

// Stable cache key for a scope. Sorted, so two users with the same access
// share a cache entry and no user is ever served another scope's rows.
function scopeKey(scope) {
  if (isBranchScoped(scope)) return `b${[...scope.branchIds].sort((a, b) => a - b).join('.')}`;
  if (scope.groups?.length) return `g${[...scope.groups].sort().join('.')}`;
  return 'all';
}

// Human-readable scope, for emails and report headers
function scopeText(scope, { unrestricted = 'All schools' } = {}) {
  if (isBranchScoped(scope)) return scope.branches.join(', ') || unrestricted;
  if (scope.groups?.length) return `${scope.groups.join(', ')} (all branches)`;
  return unrestricted;
}

const compact = (values) => values.filter((v) => v !== null && v !== undefined && v !== '');
const dedupe = (values) => [...new Set(compact(values))];

module.exports = { scopeFor, isBranchScoped, isScoped, inList, inPairs, scopeKey, scopeText };
