import React, { useEffect, useState } from "react";
import { notify } from "../../components/Toaster";
import { getBranches, createBranch, updateBranch, deleteBranch, getEntities } from "../../services/api";
import { PageHeader, GroupBadge, StatusBadge, IconButton, btnDark, btnGhost, inputBase, thBase, card, Pagination, usePagination } from "../ui";

const emptyForm = { name: "", school_group: "" };

const BranchesPage = () => {
  const [branches, setBranches] = useState([]);
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [groupFilter, setGroupFilter] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await getBranches();
      setBranches(res.data.branches);
    } catch {
      notify.error("Failed to load branches.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getEntities()
      .then((res) => setEntities(res.data.entities.filter((en) => en.is_active)))
      .catch(() => {});
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createBranch(form);
      notify.success("Branch added.");
      setModalOpen(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Failed to add branch.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (branch) => {
    try {
      await updateBranch(branch.id, { is_active: !branch.is_active });
      notify.success(branch.is_active ? "Branch deactivated." : "Branch activated.");
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Update failed.");
    }
  };

  const handleDelete = async (branch) => {
    if (!window.confirm(`Remove "${branch.name}" permanently?`)) return;
    try {
      await deleteBranch(branch.id);
      notify.success("Branch removed.");
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Remove failed.");
    }
  };

  const visible = groupFilter
    ? branches.filter((b) => b.school_group === groupFilter)
    : branches;

  const pager = usePagination(visible, 10);

  return (
    <div>
      <PageHeader
        eyebrow="Careers · Network"
        title="Branches"
        sub={
          <p>
            <span className="text-[#dc2626] font-semibold">
              {branches.filter((b) => b.is_active).length} active
            </span>
            <span className="text-[#948d88]">
              {" "}· {branches.length} total — active branches are available when creating job openings
            </span>
          </p>
        }
        actions={
          <>
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className={inputBase}
            >
              <option value="">All Entities</option>
              {entities.map((en) => (
                <option key={en.code} value={en.code}>{en.name}</option>
              ))}
            </select>
            <button onClick={() => setModalOpen(true)} className={btnDark}>
              + Add Branch
            </button>
          </>
        }
      />

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#efece9]">
              <th className={thBase}>Branch Name</th>
              <th className={thBase}>School Group</th>
              <th className={thBase}>Status</th>
              <th className={`${thBase} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-stone-400">
                  Loading…
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-stone-400">
                  No branches yet.
                </td>
              </tr>
            ) : (
              pager.paged.map((b) => (
                <tr
                  key={b.id}
                  className="border-b border-[#f3f1ea] last:border-b-0 hover:bg-[#faf9f8] transition-colors"
                >
                  <td className="px-4 py-3.5 font-semibold text-[#2a2426]">{b.name}</td>
                  <td className="px-4 py-3.5">
                    <GroupBadge group={b.school_group} />
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge active={!!b.is_active} />
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <IconButton
                        icon="power"
                        title={b.is_active ? "Deactivate branch" : "Activate branch"}
                        tone={b.is_active ? "danger" : "success"}
                        onClick={() => toggleActive(b)}
                      />
                      <IconButton
                        icon="trash"
                        title="Remove branch"
                        onClick={() => handleDelete(b)}
                      />
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

      {/* Add Branch Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="font-poppins text-xl font-semibold text-[#2a2426] mb-5">Add Branch</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Entity *</label>
                <select
                  value={form.school_group}
                  onChange={(e) => setForm({ ...form, school_group: e.target.value })}
                  required
                  className="w-full border border-[#d8d3cf] rounded-md px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#a81724]/20 focus:border-[#a81724]"
                >
                  <option value="" disabled>Select an entity</option>
                  {entities.map((en) => (
                    <option key={en.code} value={en.code}>{en.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Branch Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder="e.g. Delhi Public School, Nacharam"
                  className="w-full border border-[#d8d3cf] rounded-md px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#a81724]/20 focus:border-[#a81724]"
                />
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
                  {saving ? "Adding…" : "Add Branch"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default BranchesPage;
