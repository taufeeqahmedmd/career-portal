import React, { useEffect, useState } from "react";
import { getEntities, createEntity, updateEntity, deleteEntity } from "../../services/api";
import { notify } from "../../components/Toaster";
import {
  PageHeader,
  StatusBadge,
  btnDark,
  btnGhost,
  thBase,
  card,
  registerEntities,
  Pagination,
  usePagination,
} from "../ui";

const emptyForm = { code: "", name: "", color: "#1e3a8a" };

const EntitiesPage = () => {
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getEntities();
      setEntities(res.data.entities);
      registerEntities(res.data.entities);
    } catch (err) {
      notify.error(err.response?.data?.error || "Failed to load entities.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const pager = usePagination(entities, 10);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (entity) => {
    setEditing(entity);
    setForm({ code: entity.code, name: entity.name, color: entity.color });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await updateEntity(editing.id, { name: form.name, color: form.color });
        notify.success("Entity updated.");
      } else {
        await createEntity(form);
        notify.success("Entity created.");
      }
      setModalOpen(false);
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (entity) => {
    try {
      await updateEntity(entity.id, { is_active: !entity.is_active });
      notify.success(entity.is_active ? "Entity deactivated." : "Entity activated.");
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Update failed.");
    }
  };

  const handleDelete = async (entity) => {
    if (!window.confirm(`Delete the "${entity.name}" entity permanently?`)) return;
    try {
      await deleteEntity(entity.id);
      notify.success("Entity deleted.");
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Delete failed.");
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Careers · Network"
        title="Entities"
        sub={
          <p>
            <span className="text-[#dc2626] font-semibold">
              {entities.filter((e) => e.is_active).length} active
            </span>
            <span className="text-[#948d88]">
              {" "}· school groups that branches, openings and users belong to
            </span>
          </p>
        }
        actions={
          <button onClick={openCreate} className={btnDark}>
            + Add Entity
          </button>
        }
      />

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#efece9]">
              <th className={thBase}>Entity</th>
              <th className={thBase}>Code</th>
              <th className={thBase}>Color</th>
              <th className={thBase}>Usage</th>
              <th className={thBase}>Status</th>
              <th className={`${thBase} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-stone-400">
                  Loading…
                </td>
              </tr>
            ) : entities.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-stone-400">
                  No entities yet.
                </td>
              </tr>
            ) : (
              pager.paged.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-[#f3f1ea] last:border-b-0 hover:bg-[#faf9f8] transition-colors"
                >
                  <td className="px-4 py-3.5 font-semibold text-[#2a2426]">{e.name}</td>
                  <td className="px-4 py-3.5">
                    <span className="font-mono text-[11px] text-stone-600 bg-[#f4f3f1] border border-[#e7e4e1] rounded px-1.5 py-0.5">
                      {e.code}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="w-4 h-4 rounded-md border border-black/10"
                        style={{ backgroundColor: e.color }}
                      />
                      <span className="font-mono text-[11px] text-stone-500">{e.color}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-stone-500">
                    {e.branches_count} branch{e.branches_count !== 1 ? "es" : ""} ·{" "}
                    {e.openings_count} open
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge active={!!e.is_active} />
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => openEdit(e)}
                      className="text-[#2a2426] hover:underline text-sm font-medium mr-4"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(e)}
                      className={`text-sm font-medium hover:underline mr-4 ${
                        e.is_active ? "text-[#dc2626]" : "text-emerald-600"
                      }`}
                    >
                      {e.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => handleDelete(e)}
                      className="text-sm font-medium text-stone-500 hover:text-[#dc2626] hover:underline"
                    >
                      Delete
                    </button>
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="font-poppins text-xl font-semibold text-[#2a2426] mb-5">
              {editing ? `Edit Entity — ${editing.code}` : "Add Entity"}
            </h3>
            <form onSubmit={handleSave} className="space-y-4">
              {!editing && (
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Code *</label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    required
                    placeholder="e.g. DPS"
                    className="w-full border border-[#d8d3cf] rounded-md px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#a81724]/20 focus:border-[#a81724]"
                  />
                  <p className="text-xs text-stone-400 mt-1">
                    Short identifier used across branches, openings and users. Cannot be changed later.
                  </p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder="e.g. Delhi Public Schools"
                  className="w-full border border-[#d8d3cf] rounded-md px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#a81724]/20 focus:border-[#a81724]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Accent Color *</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    className="w-11 h-11 rounded-md border border-[#e7e4e1] cursor-pointer p-1 bg-white"
                  />
                  <span className="font-mono text-xs text-stone-500">{form.color}</span>
                </div>
                <p className="text-xs text-stone-400 mt-1">
                  Used for this entity's badges and charts across the site.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className={`${btnGhost} flex-1 justify-center`}
                >
                  Cancel
                </button>
                <button type="submit" disabled={saving} className={`${btnDark} flex-1 justify-center`}>
                  {saving ? "Saving…" : editing ? "Save Changes" : "Create Entity"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default EntitiesPage;
