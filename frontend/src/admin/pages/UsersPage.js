import React, { useEffect, useState } from "react";
import { notify } from "../../components/Toaster";
import {
  getUsers,
  createUser,
  setUserActive,
  updateUser,
  getBranches,
  getRoles,
  getEntities,
  setUserTotp,
  getSecuritySettings,
  updateSecuritySettings,
} from "../../services/api";
import { useAuth } from "../AuthContext";
import ImportCsvModal from "../ImportCsvModal";
import { importUsersCsv } from "../../services/api";
import { PageHeader, StatusBadge, IconButton, btnDark, btnGhost, thBase, card, Pagination, usePagination, formatDate, formatTime } from "../ui";

// Filled from /admin/entities on mount; falls back to the raw code
let GROUP_LABELS = {};

// Passwords are never chosen by the creator: every account starts on a shared
// initial password and the owner has to replace it at first sign-in
const emptyForm = { name: "", email: "", role_id: "", school_groups: [], branch_ids: [] };

// A user may hold several entities and, inside them, several branches. No
// branches means every branch of the chosen entities.
const CheckList = ({ options, selected, onToggle, empty }) => {
  if (!options.length) {
    return <p className="text-xs text-stone-400 px-3 py-2.5">{empty}</p>;
  }
  return (
    <div className="max-h-44 overflow-y-auto border border-[#d8d3cf] rounded-md divide-y divide-[#efece7]">
      {options.map((opt) => (
        <label
          key={opt.value}
          className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-[#faf8f5]"
        >
          <input
            type="checkbox"
            checked={selected.includes(opt.value)}
            onChange={() => onToggle(opt.value)}
            className="w-4 h-4 accent-[#a81724] cursor-pointer"
          />
          <span className="text-stone-700">{opt.label}</span>
          {opt.hint && <span className="text-xs text-stone-400 ml-auto">{opt.hint}</span>}
        </label>
      ))}
    </div>
  );
};

const ShieldIcon = ({ on }) => (
  <svg
    className="w-3.5 h-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    {on && <path d="M9 11.5l2 2 4-4" />}
  </svg>
);

// Reused for the per-user and the portal-wide two-factor switches
const Switch = ({ checked, disabled, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={onChange}
    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
      checked ? "bg-[#a81724]" : "bg-[#ddd7cb]"
    } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
  >
    <span
      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
        checked ? "translate-x-[19px]" : "translate-x-[3px]"
      }`}
    />
  </button>
);

const isUnrestricted = (u) => (u.role_permissions || []).includes("*");

const scopeLabel = (u) => {
  if (isUnrestricted(u)) return "All Schools";
  const branchNames = (u.branches || []).map((b) => b.name);
  if (branchNames.length) return branchNames.join(", ");
  const groups = u.school_groups || [];
  if (groups.length) {
    return `${groups.map((g) => GROUP_LABELS[g] || g).join(", ")} (all branches)`;
  }
  return "All Schools";
};

const UsersPage = () => {
  const { user: currentUser, can } = useAuth();
  const canRoles = can("roles.manage");
  // Bulk import is a separate grant from "manage users" - see the Roles page
  const canImport = can("data.import");
  const canSecurity = can("security.manage");
  // Only a super admin may change a sign-in email; the server enforces it too
  const isSuperAdmin = (currentUser?.permissions || []).includes("*");
  // The signed-in user's own scope caps what they can hand out
  const myGroups = currentUser?.school_groups || [];
  const myBranchIds = currentUser?.branch_ids || [];
  const myScopeLabel = myBranchIds.length
    ? (currentUser?.branches || []).map((b) => b.name).join(", ")
    : myGroups.length
      ? myGroups.map((g) => GROUP_LABELS[g] || g).join(", ")
      : "your scope";

  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [roles, setRoles] = useState([]);
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // user being edited (needs roles.manage)
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [security, setSecurity] = useState(null); // { require_totp, initial_password }
  const [totpBusyId, setTotpBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getUsers();
      setUsers(res.data.users);
    } catch (err) {
      notify.error(err.response?.data?.error || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getBranches()
      .then((res) => setBranches(res.data.branches))
      .catch(() => {});
    getRoles()
      .then((res) => setRoles(res.data.roles))
      .catch(() => {});
    getEntities()
      .then((res) => {
        const active = res.data.entities.filter((en) => en.is_active);
        setEntities(active);
        GROUP_LABELS = Object.fromEntries(res.data.entities.map((en) => [en.code, en.name]));
      })
      .catch(() => {});
    if (canSecurity) {
      getSecuritySettings()
        .then((res) => setSecurity(res.data))
        .catch(() => {});
    }
    // canSecurity is derived from the signed-in user, which is settled by the
    // time this page renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleGlobalTotp = async () => {
    const next = !security.require_totp;
    try {
      await updateSecuritySettings({ require_totp: next });
      setSecurity((s) => ({ ...s, require_totp: next }));
      notify.success(
        next
          ? "Two-factor authentication is now required for every user."
          : "Two-factor authentication is no longer required portal-wide."
      );
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Could not update the setting.");
    }
  };

  const toggleUserTotp = async (u) => {
    setTotpBusyId(u.id);
    try {
      await setUserTotp(u.id, !u.totp_enabled);
      notify.success(
        u.totp_enabled
          ? `Two-factor turned off for ${u.name}. Their authenticator entry no longer works.`
          : `Two-factor turned on for ${u.name}. They will set up their app at the next sign-in.`
      );
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Could not update two-factor authentication.");
    } finally {
      setTotpBusyId(null);
    }
  };

  // Entities the actor may assign: their own, or all of them when unscoped
  const assignableEntities = entities.filter(
    (en) => !myGroups.length || myGroups.includes(en.code)
  );

  // Branches of the entities currently ticked, and never outside the actor's own
  const assignableBranches = branches.filter(
    (b) =>
      b.is_active &&
      (!myBranchIds.length || myBranchIds.includes(b.id)) &&
      (!myGroups.length || myGroups.includes(b.school_group)) &&
      (!form.school_groups.length || form.school_groups.includes(b.school_group))
  );

  const toggleGroup = (code) => {
    const on = form.school_groups.includes(code);
    setForm({
      ...form,
      school_groups: on
        ? form.school_groups.filter((c) => c !== code)
        : [...form.school_groups, code],
      // Dropping an entity drops the branches that belonged to it
      branch_ids: on
        ? form.branch_ids.filter(
            (id) => branches.find((b) => b.id === id)?.school_group !== code
          )
        : form.branch_ids,
    });
  };

  const toggleBranch = (id) => {
    const on = form.branch_ids.includes(id);
    const group = branches.find((b) => b.id === id)?.school_group;
    setForm({
      ...form,
      branch_ids: on ? form.branch_ids.filter((b) => b !== id) : [...form.branch_ids, id],
      // A branch carries its entity, so ticking one selects the entity too
      school_groups:
        !on && group && !form.school_groups.includes(group)
          ? [...form.school_groups, group]
          : form.school_groups,
    });
  };

  const roleById = (id) => roles.find((r) => String(r.id) === String(id));
  const selectedRoleUnrestricted = (roleById(form.role_id)?.permissions || []).includes("*");

  const pager = usePagination(users, 10);

  const openCreate = () => {
    setEditing(null);
    const defaultRole = roles.find((r) => r.name === "Admin");
    setForm({
      ...emptyForm,
      role_id: defaultRole ? String(defaultRole.id) : "",
      // A creator who cannot assign roles can only create inside its own scope,
      // so that scope is pre-filled rather than left to be chosen
      school_groups: canRoles ? [] : myGroups,
      branch_ids: !canRoles ? myBranchIds : [],
    });
    setModalOpen(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    setForm({
      name: u.name,
      email: u.email,
      role_id: u.role_id ? String(u.role_id) : "",
      school_groups: u.school_groups || [],
      branch_ids: u.branch_ids || [],
      reset_password: false,
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        role_id: form.role_id ? Number(form.role_id) : undefined,
        school_groups: form.school_groups,
        branch_ids: form.branch_ids,
      };
      if (editing) {
        if (form.reset_password) payload.reset_password = true;
        if (isSuperAdmin && form.email) payload.email = form.email;
        const res = await updateUser(editing.id, payload);
        notify.success(
          res.data.initial_password
            ? `User updated. Temporary password: ${res.data.initial_password} — they must change it at next sign-in.`
            : "User updated."
        );
      } else {
        const res = await createUser({ ...payload, email: form.email });
        const temp = res.data.initial_password;
        if (res.data.email_sent) {
          notify.success(`User created. Credentials emailed to ${form.email}.`);
        } else {
          notify.warning(
            `User created, but the email could not be sent. Share these manually — ${form.email} / ${temp}`
          );
        }
      }
      setModalOpen(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u) => {
    try {
      await setUserActive(u.id, !u.is_active);
      notify.success(u.is_active ? "User deactivated." : "User activated.");
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Update failed.");
    }
  };

  // Scope controls inside the modal
  const showRoleSelect = canRoles && roles.length > 0;
  const showScopeControls = !selectedRoleUnrestricted;
  // A creator without roles.manage cannot widen a user beyond its own scope, so
  // there is nothing to pick unless the creator is itself unscoped
  const showGroupSelect =
    showScopeControls && (canRoles || (!myGroups.length && !myBranchIds.length));
  const showBranchSelect = showScopeControls && (canRoles || !myBranchIds.length);

  return (
    <div>
      <PageHeader
        eyebrow="Careers · Access"
        title="Users"
        sub={
          <p>
            <span className="text-[#dc2626] font-semibold">{users.length} total</span>
            {!canRoles && (
              <span className="text-[#948d88]">
                {" "}· within {myScopeLabel}
              </span>
            )}
          </p>
        }
        actions={
          <>
            {canImport && (
              <button onClick={() => setImportOpen(true)} className={btnGhost}>
                Import CSV
              </button>
            )}
            <button onClick={openCreate} className={btnDark}>
              + Add User
            </button>
          </>
        }
      />

      {/* Portal-wide two-factor switch - super admin territory */}
      {canSecurity && security && (
        <div className={`${card} p-4 mb-4 flex items-start gap-3`}>
          <span
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
              security.require_totp ? "bg-[#a81724]/10 text-[#a81724]" : "bg-stone-100 text-stone-400"
            }`}
          >
            <ShieldIcon on={security.require_totp} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#2a2426]">
              Require two-factor authentication for everyone
            </p>
            <p className="text-xs text-[#948d88] mt-0.5 leading-relaxed">
              Every user has to enter a code from their authenticator app at sign-in. Leave this
              off to decide account by account with the switches below.
              {!security.captcha_configured && (
                <span className="block mt-1 text-amber-700">
                  Cloudflare Turnstile is not configured — sign-in and the public application form
                  are running without a captcha.
                </span>
              )}
            </p>
          </div>
          <Switch
            checked={security.require_totp}
            onChange={toggleGlobalTotp}
            label="Require two-factor authentication for every user"
          />
        </div>
      )}

      {importOpen && (
        <ImportCsvModal
          title="Import Users"
          description="Email is the identifier — rows whose email already exists are skipped, never overwritten. Every imported account starts on the temporary password and must change it at first sign-in."
          // The role column only appears for someone who can actually assign
          // roles - the server rejects any row naming one otherwise, so
          // including it would make the template fail every row it contains
          columns={[
            { name: "name", required: true, note: "Full name of the user." },
            { name: "email", required: true, note: "Used as the unique identifier." },
            ...(canRoles
              ? [{ name: "role", note: "Role name exactly as listed under Roles. Defaults to Admin." }]
              : []),
            {
              name: "entity",
              note: "Entity code, e.g. DPS. Separate several with a semicolon. Blank = all schools.",
            },
            {
              name: "branch",
              note: "Branch names within those entities, semicolon-separated. Blank = all branches.",
            },
          ]}
          // Built from real branches and roles so the downloaded file imports as-is
          sample={(() => {
            const roleName = roles.find((r) => r.name === "Admin")?.name || "Admin";
            const roleCell = canRoles ? `${roleName},` : "";
            const usable = branches.filter(
              (b) =>
                b.is_active &&
                (!myGroups.length || myGroups.includes(b.school_group)) &&
                (!myBranchIds.length || myBranchIds.includes(b.id))
            );
            const people = ["Asha Rao,asha@example.com", "Ravi Kumar,ravi@example.com"];
            if (!usable.length) return [`${people[0]},${roleCell}"${myGroups.join(", ")}",`];
            // Two rows: one branch, then two branches in one cell - the second
            // shows the comma-separated form the importer accepts
            const [first, second] = usable;
            const rows = [`${people[0]},${roleCell}"${first.school_group}","${first.name}"`];
            if (second) {
              // Semicolons, not commas: branch names contain commas of their own
              const groups = [...new Set([first.school_group, second.school_group])].join("; ");
              rows.push(`${people[1]},${roleCell}"${groups}","${first.name}; ${second.name}"`);
            }
            return rows;
          })()}
          onImport={importUsersCsv}
          onClose={() => setImportOpen(false)}
          onDone={load}
        />
      )}

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#efece9]">
              <th className={thBase}>Name</th>
              <th className={thBase}>Email</th>
              <th className={thBase}>Role</th>
              <th className={thBase}>Access Scope</th>
              <th className={thBase}>Last Login</th>
              {canSecurity && <th className={`${thBase} text-center`}>2FA</th>}
              <th className={thBase}>Status</th>
              <th className={`${thBase} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={canSecurity ? 8 : 7} className="px-4 py-10 text-center text-stone-400">
                  Loading…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={canSecurity ? 8 : 7} className="px-4 py-10 text-center text-stone-400">
                  No users in your scope yet.
                </td>
              </tr>
            ) : (
              pager.paged.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-[#f3f1ea] last:border-b-0 hover:bg-[#faf9f8] transition-colors"
                >
                  <td className="px-4 py-3.5 font-semibold text-[#2a2426]">
                    {u.name}
                    {u.id === currentUser?.id && (
                      <span className="ml-2 text-xs font-normal text-[#948d88]">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-stone-600">{u.email}</td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                        isUnrestricted(u)
                          ? "bg-[#a81724] text-white"
                          : "bg-[#f4f3f1] text-stone-600"
                      }`}
                    >
                      {u.role_name || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-stone-600 text-sm">{scopeLabel(u)}</td>
                  <td className="px-4 py-3.5">
                    {u.last_login_at ? (
                      <>
                        <p className="text-stone-700 text-sm">{formatDate(u.last_login_at)}</p>
                        <p className="font-mono text-[11px] text-[#948d88] mt-0.5">
                          {formatTime(u.last_login_at)}
                        </p>
                      </>
                    ) : (
                      <span className="text-[#948d88] text-sm">Never</span>
                    )}
                  </td>
                  {canSecurity && (
                    <td className="px-4 py-3.5 text-center">
                      <div className="inline-flex flex-col items-center gap-1">
                        <Switch
                          checked={!!u.totp_enabled || !!security?.require_totp}
                          disabled={totpBusyId === u.id || !!security?.require_totp}
                          onChange={() => toggleUserTotp(u)}
                          label={`Two-factor authentication for ${u.name}`}
                        />
                        <span className="text-[10px] text-[#948d88] leading-none">
                          {security?.require_totp
                            ? "required"
                            : u.totp_enabled
                              ? u.totp_confirmed_at
                                ? "active"
                                : "setup pending"
                              : "off"}
                        </span>
                      </div>
                    </td>
                  )}
                  <td className="px-4 py-3.5">
                    <StatusBadge active={!!u.is_active} />
                    {!!u.must_change_password && (
                      <p
                        className="text-[10px] text-amber-700 mt-1"
                        title="This account is still on the password it was issued"
                      >
                        password not set
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      {canRoles && (
                        <IconButton icon="edit" title="Edit user" onClick={() => openEdit(u)} />
                      )}
                      {u.id !== currentUser?.id && (
                        <IconButton
                          icon="power"
                          title={u.is_active ? "Deactivate user" : "Activate user"}
                          tone={u.is_active ? "danger" : "success"}
                          onClick={() => toggleActive(u)}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={pager.page}
        totalPages={pager.totalPages}
        onPage={pager.setPage}
        totalItems={pager.total}
        pageSize={pager.pageSize}
      />

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="font-poppins text-xl font-semibold text-[#2a2426] mb-5">
              {editing ? `Edit User — ${editing.email}` : "Add User"}
            </h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="w-full border border-[#d8d3cf] rounded-md px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#a81724]/20 focus:border-[#a81724]"
                />
              </div>
              {/* Editable only by a super admin: the address is the account's
                  identity and where password resets and export approval codes
                  are sent */}
              {(!editing || isSuperAdmin) && (
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Email *</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                    className="w-full border border-[#d8d3cf] rounded-md px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#a81724]/20 focus:border-[#a81724]"
                  />
                  {editing && (
                    <p className="text-xs text-stone-400 mt-1">
                      Changing this changes how they sign in, and where their password reset
                      codes go.
                    </p>
                  )}
                </div>
              )}
              {/* The creator never picks a password. New accounts start on the
                  shared initial one and must replace it at first sign-in. */}
              {editing ? (
                <label className="flex items-start gap-2.5 rounded-md border border-[#e7e4e1] bg-[#faf9f8] px-3 py-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!form.reset_password}
                    onChange={(e) => setForm({ ...form, reset_password: e.target.checked })}
                    className="mt-0.5 w-4 h-4 rounded accent-[#a81724] cursor-pointer"
                  />
                  <span>
                    <span className="block text-sm font-medium text-stone-700">
                      Reset to the temporary password
                    </span>
                    <span className="block text-xs text-stone-500 mt-0.5">
                      Signs them out everywhere and makes them choose a new password at the
                      next sign-in.
                    </span>
                  </span>
                </label>
              ) : (
                <p className="text-xs text-stone-500 bg-[#faf9f8] border border-[#e7e4e1] rounded-md px-3 py-2.5">
                  The account starts on the temporary password
                  <strong className="font-mono text-[#2a2426]">
                    {" "}
                    {security?.initial_password || "12345678"}
                  </strong>
                  . They must choose their own before they can use the portal.
                </p>
              )}

              {showRoleSelect ? (
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Role *</label>
                  <select
                    value={form.role_id}
                    onChange={(e) => setForm({ ...form, role_id: e.target.value })}
                    className="w-full border border-[#d8d3cf] rounded-md px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#a81724]/20 focus:border-[#a81724]"
                  >
                    {roles
                      .filter(
                        (r) =>
                          r.is_active !== 0 || String(r.id) === String(form.role_id)
                      )
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                          {r.permissions.includes("*") ? " (full access)" : ""}
                          {r.is_active === 0 ? " (deactivated)" : ""}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-stone-400 mt-1">
                    Roles are defined on the Roles page.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-stone-400">New users will have the Admin role.</p>
              )}

              {showScopeControls && (
                <>
                  {showGroupSelect ? (
                    <div>
                      <div className="flex items-baseline justify-between mb-1">
                        <label className="block text-sm font-medium text-stone-700">Entities</label>
                        <span className="text-xs text-stone-400">
                          {form.school_groups.length
                            ? `${form.school_groups.length} selected`
                            : "All entities"}
                        </span>
                      </div>
                      <CheckList
                        options={assignableEntities.map((en) => ({
                          value: en.code,
                          label: en.name,
                        }))}
                        selected={form.school_groups}
                        onToggle={toggleGroup}
                        empty="No entities available to assign."
                      />
                      <p className="text-xs text-stone-400 mt-1">
                        Select none to give access to every entity.
                      </p>
                    </div>
                  ) : (
                    myGroups.length > 0 && (
                      <p className="text-xs text-stone-400">
                        Entities:{" "}
                        <strong>
                          {myGroups.map((g) => GROUP_LABELS[g] || g).join(", ")}
                        </strong>{" "}
                        (yours)
                      </p>
                    )
                  )}

                  {showBranchSelect ? (
                    <div>
                      <div className="flex items-baseline justify-between mb-1">
                        <label className="block text-sm font-medium text-stone-700">
                          Branch Access
                        </label>
                        <span className="text-xs text-stone-400">
                          {form.branch_ids.length
                            ? `${form.branch_ids.length} selected`
                            : "All branches"}
                        </span>
                      </div>
                      <CheckList
                        options={assignableBranches.map((b) => ({
                          value: b.id,
                          label: b.name,
                          hint: GROUP_LABELS[b.school_group] || b.school_group,
                        }))}
                        selected={form.branch_ids}
                        onToggle={toggleBranch}
                        empty={
                          form.school_groups.length
                            ? "The selected entities have no active branches."
                            : "Select an entity above, or leave both empty for full access."
                        }
                      />
                      <p className="text-xs text-stone-400 mt-1">
                        Leave empty for every branch of the selected entities. Pick branches to
                        limit the user to exactly those.
                      </p>
                    </div>
                  ) : (
                    (currentUser?.branches || []).length > 0 && (
                      <p className="text-xs text-stone-400">
                        Branches:{" "}
                        <strong>
                          {(currentUser.branches || []).map((b) => b.name).join(", ")}
                        </strong>{" "}
                        (yours)
                      </p>
                    )
                  )}
                </>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className={`${btnGhost} flex-1 justify-center`}
                >
                  Cancel
                </button>
                <button type="submit" disabled={saving} className={`${btnDark} flex-1 justify-center`}>
                  {saving ? "Saving…" : editing ? "Save Changes" : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersPage;
