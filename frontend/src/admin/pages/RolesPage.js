import React, { useEffect, useState } from "react";
import { notify } from "../../components/Toaster";
import {
  getRoles,
  getPermissionCatalog,
  createRole,
  updateRole,
  deleteRole,
} from "../../services/api";
import { PageHeader, StatusBadge, IconButton, btnDark, btnGhost, card, inputBase, thBase } from "../ui";

const emptyForm = { name: "", description: "", permissions: [] };

const Toggle = ({ checked, disabled, busy, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled || busy}
    onClick={onChange}
    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
      checked ? "bg-[#a81724]" : "bg-[#ddd7cb]"
    } ${disabled ? "opacity-40 cursor-not-allowed" : busy ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
  >
    <span
      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
        checked ? "translate-x-[19px]" : "translate-x-[3px]"
      }`}
    />
  </button>
);

const RolesPage = () => {
  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [savingCell, setSavingCell] = useState(null); // "roleId:permKey" while a toggle saves

  const load = async () => {
    setLoading(true);
    try {
      const res = await getRoles();
      setRoles(res.data.roles);
    } catch (err) {
      notify.error(err.response?.data?.error || "Failed to load roles.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getPermissionCatalog()
      .then((res) => setCatalog(res.data.permissions))
      .catch(() => {});
  }, []);

  const isSuperRole = (role) => role.permissions.includes("*");

  const toggleRoleActive = async (role) => {
    try {
      await updateRole(role.id, { is_active: !role.is_active });
      notify.success(role.is_active ? "Role deactivated." : "Role activated.");
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Update failed.");
    }
  };

  const togglePermission = async (role, key) => {
    if (isSuperRole(role) || !role.is_active) return; // locked or deactivated
    const has = role.permissions.includes(key);
    const next = has
      ? role.permissions.filter((p) => p !== key)
      : [...role.permissions, key];

    if (next.length === 0) {
      notify.error("A role needs at least one permission.");
      return;
    }

    const cell = `${role.id}:${key}`;
    const previous = roles;
    setSavingCell(cell);
    // Optimistic update; reverted if the server rejects it
    setRoles((rs) => rs.map((r) => (r.id === role.id ? { ...r, permissions: next } : r)));
    try {
      await updateRole(role.id, { permissions: next });
    } catch (err) {
      setRoles(previous);
      notify.error(err.response?.data?.error || "Failed to update permission.");
    } finally {
      setSavingCell(null);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (role) => {
    setEditing(role);
    setForm({ name: role.name, description: role.description, permissions: [] });
    setModalOpen(true);
  };

  const toggleFormPermission = (key) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter((p) => p !== key)
        : [...prev.permissions, key],
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        // Permissions are managed via the matrix toggles; only name/description here
        await updateRole(editing.id, { name: form.name, description: form.description });
        notify.success("Role updated.");
      } else {
        await createRole(form);
        notify.success("Role created.");
      }
      setModalOpen(false);
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role) => {
    if (!window.confirm(`Delete the "${role.name}" role permanently?`)) return;
    try {
      await deleteRole(role.id);
      notify.success("Role deleted.");
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Delete failed.");
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Careers · Access"
        title="Roles"
        sub={
          <p className="text-[#948d88]">
            Flip a toggle to grant or revoke a permission — changes save instantly
          </p>
        }
        actions={
          <button onClick={openCreate} className={btnDark}>
            + Add Role
          </button>
        }
      />

      {/* Role × permission matrix */}
      <div className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#efece9]">
                <th className={`${thBase} min-w-[220px]`}>Role</th>
                {catalog.map((p) => (
                  <th key={p.key} className={`${thBase} text-center min-w-[110px]`}>
                    <span className="block normal-case tracking-normal text-[11px] font-semibold text-stone-600">
                      {p.label}
                    </span>
                    <span className="block font-mono text-[9px] lowercase tracking-normal font-normal mt-0.5">
                      {p.key}
                    </span>
                  </th>
                ))}
                <th className={`${thBase} text-right min-w-[90px]`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={catalog.length + 2} className="px-4 py-12 text-center text-[#948d88]">
                    Loading…
                  </td>
                </tr>
              ) : roles.length === 0 ? (
                <tr>
                  <td colSpan={catalog.length + 2} className="px-4 py-12 text-center text-[#948d88]">
                    No roles yet.
                  </td>
                </tr>
              ) : (
                roles.map((role) => {
                  const superRole = isSuperRole(role);
                  const inactive = !role.is_active;
                  return (
                    <tr
                      key={role.id}
                      className={`border-b border-[#f3f1ea] last:border-b-0 hover:bg-[#faf9f8] transition-colors ${
                        inactive ? "opacity-60" : ""
                      }`}
                    >
                      <td className="px-4 py-3.5 align-top">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-poppins text-base font-semibold text-[#2a2426]">
                            {role.name}
                          </span>
                          {role.is_system ? (
                            <span className="text-[9px] font-semibold uppercase tracking-[0.12em] bg-[#f4f3f1] text-stone-500 px-2 py-0.5 rounded-full">
                              System
                            </span>
                          ) : null}
                          {inactive && <StatusBadge active={false} />}
                        </div>
                        <p className="font-mono text-[10px] text-[#948d88] mt-0.5">
                          {role.users_count} user{role.users_count !== 1 ? "s" : ""}
                        </p>
                        {role.description && (
                          <p className="text-xs text-stone-500 mt-1 max-w-[240px]">
                            {role.description}
                          </p>
                        )}
                        {superRole && (
                          <p className="inline-flex items-center gap-1 text-[10px] text-[#948d88] mt-1.5">
                            <svg
                              className="w-3 h-3"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <rect x="4" y="11" width="16" height="10" rx="2" />
                              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                            </svg>
                            Full access — locked
                          </p>
                        )}
                      </td>
                      {catalog.map((p) => (
                        <td key={p.key} className="px-4 py-3.5 text-center align-middle">
                          <Toggle
                            checked={superRole || role.permissions.includes(p.key)}
                            disabled={superRole || inactive}
                            busy={savingCell === `${role.id}:${p.key}`}
                            onChange={() => togglePermission(role, p.key)}
                            label={`${role.name} — ${p.label}`}
                          />
                        </td>
                      ))}
                      <td className="px-4 py-3.5 text-right align-middle whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {!superRole && (
                            <IconButton
                              icon="edit"
                              title="Edit role"
                              onClick={() => openEdit(role)}
                            />
                          )}
                          {!role.is_system && (
                            <IconButton
                              icon="power"
                              title={role.is_active ? "Deactivate role" : "Activate role"}
                              tone={role.is_active ? "danger" : "success"}
                              onClick={() => toggleRoleActive(role)}
                            />
                          )}
                          {!role.is_system && inactive && (
                            <IconButton
                              icon="trash"
                              title="Delete role"
                              onClick={() => handleDelete(role)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#efece9] bg-[#faf9f8]">
          <p className="text-xs text-[#948d88]">
            {roles.length} role{roles.length === 1 ? "" : "s"} ·{" "}
            {catalog.length} permission{catalog.length === 1 ? "" : "s"}
          </p>
          <p className="font-mono text-[11px] text-[#948d88]">
            assign roles to users from the Users page
          </p>
        </div>
      </div>

      {/* Add / Rename Role Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="font-poppins text-xl font-semibold text-[#2a2426] mb-5">
              {editing ? `Edit Role — ${editing.name}` : "Add Role"}
            </h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Role Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  disabled={editing?.is_system}
                  placeholder="e.g. HR Executive"
                  className={`${inputBase} w-full ${
                    editing?.is_system ? "bg-stone-100 text-stone-500" : ""
                  }`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Description</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What is this role for?"
                  className={`${inputBase} w-full`}
                />
              </div>
              {editing ? (
                <p className="text-xs text-[#948d88]">
                  Permissions are managed with the toggles in the table.
                </p>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-2">
                    Permissions *
                  </label>
                  <div className="space-y-2.5 border border-[#e7e4e1] rounded-md p-4">
                    {catalog.map((p) => (
                      <div key={p.key} className="flex items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="text-sm font-medium text-stone-800 block">
                            {p.label}
                          </span>
                          <span className="font-mono text-[10px] text-[#948d88]">{p.key}</span>
                        </span>
                        <Toggle
                          checked={form.permissions.includes(p.key)}
                          onChange={() => toggleFormPermission(p.key)}
                          label={p.label}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className={`${btnGhost} flex-1 justify-center`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || (!editing && form.permissions.length === 0)}
                  className={`${btnDark} flex-1 justify-center`}
                >
                  {saving ? "Saving…" : editing ? "Save Changes" : "Create Role"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RolesPage;
