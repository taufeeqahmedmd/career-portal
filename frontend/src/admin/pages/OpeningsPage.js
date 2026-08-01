import React, { useEffect, useState } from "react";
import { notify } from "../../components/Toaster";
import {
  getAdminOpenings,
  createOpening,
  updateOpening,
  getBranches,
  getEntities,
  getActiveFlowOptions,
  importOpeningsCsv,
} from "../../services/api";
import { useAuth } from "../AuthContext";
import ImportCsvModal from "../ImportCsvModal";
import { PageHeader, GroupBadge, StatusBadge, IconButton, btnDark, btnGhost, thBase, card, Pagination, usePagination, formatDate } from "../ui";

const CATEGORIES = ["Academic", "Non-Academic"];

const emptyForm = {
  position: "",
  branch: "",
  school_group: "",
  category: "Academic",
  eligibility: "",
  curriculum: "",
};

const OpeningsPage = () => {
  const { user, can } = useAuth();
  // Bulk import is granted separately from openings.manage on the Roles page
  const canImport = can("data.import");
  // Scoped admins can only manage openings for their own school group
  const scopedGroup = user?.school_group || null;
  const [openings, setOpenings] = useState([]);
  const [branches, setBranches] = useState([]);
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // opening being edited, or null for create
  const [form, setForm] = useState(emptyForm);
  const [roleOptions, setRoleOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getAdminOpenings();
      setOpenings(res.data.openings);
    } catch {
      notify.error("Failed to load openings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getBranches()
      .then((res) => setBranches(res.data.branches))
      .catch(() => notify.error("Failed to load branches."));
    getEntities()
      .then((res) => setEntities(res.data.entities.filter((en) => en.is_active)))
      .catch(() => {});
    // Positions come from the roles list managed in Flow Configuration
    getActiveFlowOptions()
      .then((res) => setRoleOptions(res.data.suggested_roles || []))
      .catch(() => {});
  }, []);

  // Active branches for the school group currently selected in the modal
  const branchOptions = branches.filter(
    (b) => b.is_active && b.school_group === form.school_group
  );

  // Only positions mapped to the chosen category
  const positionOptions = roleOptions.filter(
    (r) => (r.category || "Academic") === form.category
  );

  const pager = usePagination(openings, 10);

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...emptyForm,
      school_group: scopedGroup || emptyForm.school_group,
      // Branch-scoped admins can only post openings for their own branch
      branch: user?.branch_name || "",
    });
    setModalOpen(true);
  };

  const openEdit = (opening) => {
    setEditing(opening);
    setForm({
      position: opening.position,
      branch: opening.branch,
      school_group: opening.school_group,
      category: opening.category || "Academic",
      eligibility: opening.eligibility,
      curriculum: opening.curriculum || "",
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await updateOpening(editing.id, form);
        notify.success("Opening updated.");
      } else {
        await createOpening(form);
        notify.success("Opening created.");
      }
      setModalOpen(false);
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (opening) => {
    try {
      await updateOpening(opening.id, { is_active: !opening.is_active });
      notify.success(opening.is_active ? "Opening closed." : "Opening reopened.");
      load();
    } catch (err) {
      notify.error(err.response?.data?.error || "Update failed.");
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Careers · Postings"
        title="Job Openings"
        sub={
          <p>
            <span className="text-[#dc2626] font-semibold">
              {openings.filter((o) => o.is_active).length} active
            </span>
            <span className="text-[#948d88]"> · {openings.length} total</span>
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
              + Add Opening
            </button>
          </>
        }
      />

      {importOpen && (
        <ImportCsvModal
          title="Import Openings"
          description="Branch + position identifies an opening — if that combination already exists it is skipped, so you can safely re-run a file."
          columns={[
            { name: "entity", required: true, note: "Entity code, e.g. DPS or Pallavi." },
            { name: "branch", required: true, note: "Must match an active branch of that entity." },
            { name: "position", required: true, note: "Job title, e.g. TGT - All Subjects." },
            { name: "category", note: "Academic or Non-Academic. Defaults to Academic." },
            { name: "curriculum", note: "CBSE or CIE. Ignored for non-academic roles." },
            { name: "description", note: "Shown on the careers page." },
          ]}
          // Built from real branches so the downloaded template imports as-is.
          // The branch list includes branches of deactivated entities, which
          // the importer rejects - so the entity has to be active too.
          sample={(() => {
            const usable = branches.filter(
              (b) =>
                b.is_active &&
                entities.some((en) => en.code === b.school_group) &&
                (!scopedGroup || b.school_group === scopedGroup)
            );
            if (!usable.length) {
              return ["DPS,DPS Nacharam,TGT - All Subjects,Academic,CBSE,Graduate with B.Ed."];
            }
            return usable
              .slice(0, 2)
              .map((b, i) =>
                i === 0
                  ? `${b.school_group},"${b.name}",TGT - All Subjects,Academic,CBSE,Graduate with B.Ed.`
                  : `${b.school_group},"${b.name}",Accountant,Non-Academic,,B.Com with 2 years experience`
              );
          })()}
          onImport={importOpeningsCsv}
          onClose={() => setImportOpen(false)}
          onDone={load}
        />
      )}

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#efece9]">
              <th className={thBase}>Position</th>
              <th className={thBase}>Branch</th>
              <th className={thBase}>Group</th>
              <th className={thBase}>Posted By</th>
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
            ) : openings.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-stone-400">
                  No openings yet.
                </td>
              </tr>
            ) : (
              pager.paged.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-[#f3f1ea] last:border-b-0 hover:bg-[#faf9f8] transition-colors"
                >
                  <td className="px-4 py-3.5">
                    <p className="font-semibold text-[#2a2426]">{o.position}</p>
                    <p className="text-[11px] text-[#948d88] mt-0.5">
                      {o.category || "Academic"}
                      {o.curriculum ? ` · ${o.curriculum}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 text-stone-600">{o.branch}</td>
                  <td className="px-4 py-3.5">
                    <GroupBadge group={o.school_group} />
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="text-stone-700 text-sm">{o.created_by || "—"}</p>
                    <p className="font-mono text-[11px] text-[#948d88] mt-0.5">
                      {formatDate(o.created_at)}
                    </p>
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge active={!!o.is_active} offLabel="Closed" />
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <IconButton icon="edit" title="Edit opening" onClick={() => openEdit(o)} />
                      <IconButton
                        icon="power"
                        title={o.is_active ? "Close opening" : "Reopen opening"}
                        tone={o.is_active ? "danger" : "success"}
                        onClick={() => toggleActive(o)}
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

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="font-poppins text-xl font-semibold text-[#2a2426] mb-5">
              {editing ? "Edit Opening" : "Add Opening"}
            </h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Entity *</label>
                <select
                  value={form.school_group}
                  onChange={(e) =>
                    setForm({ ...form, school_group: e.target.value, branch: "" })
                  }
                  disabled={!!scopedGroup}
                  className={`w-full border border-[#d8d3cf] rounded-md px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#a81724]/20 focus:border-[#a81724] ${
                    scopedGroup ? "bg-stone-100 text-stone-500 cursor-not-allowed" : ""
                  }`}
                >
                  <option value="" disabled>Select an entity</option>
                  {entities.map((en) => (
                    <option key={en.code} value={en.code}>{en.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Branch *</label>
                <select
                  value={form.branch}
                  onChange={(e) => setForm({ ...form, branch: e.target.value })}
                  required
                  disabled={!!user?.branch_name}
                  className={`w-full border border-[#d8d3cf] rounded-md px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#a81724]/20 focus:border-[#a81724] ${
                    user?.branch_name ? "bg-stone-100 text-stone-500 cursor-not-allowed" : ""
                  }`}
                >
                  <option value="" disabled>
                    {branchOptions.length ? "Select a branch" : "No active branches for this entity"}
                  </option>
                  {/* Keep a legacy branch selectable when editing an opening whose branch was removed */}
                  {form.branch && !branchOptions.some((b) => b.name === form.branch) && (
                    <option value={form.branch}>{form.branch} (no longer active)</option>
                  )}
                  {branchOptions.map((b) => (
                    <option key={b.id} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {branchOptions.length === 0 && !user?.branch_name && (
                  <p className="text-xs text-stone-400 mt-1">
                    A super admin can add branches under Admin → Branches.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Category *</label>
                <select
                  value={form.category}
                  onChange={(e) => {
                    const next = e.target.value;
                    // Drop a position that does not belong to the new category
                    const keeps = roleOptions.some(
                      (r) => r.label === form.position && (r.category || "Academic") === next
                    );
                    setForm({
                      ...form,
                      category: next,
                      position: keeps ? form.position : "",
                      // Curriculum only applies to academic roles
                      curriculum: next === "Academic" ? form.curriculum : "",
                    });
                  }}
                  required
                  className="w-full border border-[#d8d3cf] rounded-md px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#a81724]/20 focus:border-[#a81724]"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Position *</label>
                <select
                  value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                  required
                  className="w-full border border-[#d8d3cf] rounded-md px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#a81724]/20 focus:border-[#a81724]"
                >
                  <option value="">
                    {positionOptions.length
                      ? "Select a position"
                      : `No ${form.category.toLowerCase()} positions yet`}
                  </option>
                  {positionOptions.map((r) => (
                    <option key={r.key} value={r.label}>
                      {r.label}
                    </option>
                  ))}
                  {/* Keep an existing position selectable if it left the list */}
                  {form.position && !positionOptions.some((r) => r.label === form.position) && (
                    <option value={form.position}>{form.position} (outside this category)</option>
                  )}
                </select>
                <p className="text-xs text-stone-400 mt-1">
                  Showing {form.category} positions · managed under Configuration → Flow
                  Configuration.
                </p>
              </div>
              {form.category === "Academic" && (
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Curriculum</label>
                  <select
                    value={form.curriculum}
                    onChange={(e) => setForm({ ...form, curriculum: e.target.value })}
                    className="w-full border border-[#d8d3cf] rounded-md px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#a81724]/20 focus:border-[#a81724]"
                  >
                    <option value="">Select curriculum</option>
                    <option value="CBSE">CBSE</option>
                    <option value="CIE">CIE</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Description</label>
                <textarea
                  value={form.eligibility}
                  onChange={(e) => setForm({ ...form, eligibility: e.target.value })}
                  rows={3}
                  placeholder="Role description shown on the careers page"
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
                  {saving ? "Saving…" : editing ? "Save Changes" : "Create Opening"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default OpeningsPage;
