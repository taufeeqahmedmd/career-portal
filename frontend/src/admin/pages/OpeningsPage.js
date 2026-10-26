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
import {
  PageHeader,
  GroupBadge,
  StatusBadge,
  IconButton,
  btnDark,
  btnGhost,
  thBase,
  card,
  Pagination,
  usePagination,
  formatDate,
  FilterBar,
  SearchPill,
  FilterSelect,
  ResetFilters,
} from "../ui";

const CATEGORIES = ["Academic", "Non-Academic"];

const noFilters = {
  search: "",
  entity: "",
  branch: "", // an "entity::branch" key
  category: "",
  curriculum: "",
  status: "",
  postedBy: "",
};

const emptyForm = {
  position: "",
  branch: "",
  school_group: "",
  category: "Academic",
  eligibility: "",
  curriculum: "",
};

// Branches are picked as "entity::branch" keys - a branch name is only unique
// within its entity
const branchKey = (group, name) => `${group}::${name}`;
const fromKey = (key) => {
  const [school_group, ...rest] = key.split("::");
  return { school_group, branch: rest.join("::") };
};

const checkBox = "h-4 w-4 accent-[#a81724] shrink-0";

// Entities, then the branches of each chosen entity, all multi-select - so one
// opening can be posted to many branches across entities in one go. `taken`
// maps keys that cannot be picked to the reason shown beside them.
const BranchPicker = ({ entities, branches, groups, onGroups, picked, onPicked, taken = {} }) => {
  const toggleGroup = (code) => {
    if (groups.includes(code)) {
      onGroups(groups.filter((g) => g !== code));
      onPicked(picked.filter((k) => fromKey(k).school_group !== code));
    } else {
      onGroups([...groups, code]);
    }
  };
  const toggleBranch = (key) =>
    onPicked(picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {entities.map((en) => {
          const on = groups.includes(en.code);
          return (
            <label
              key={en.code}
              className={`inline-flex items-center gap-2 border rounded-md px-3 py-2 text-sm cursor-pointer transition-colors ${
                on ? "border-[#a81724] bg-[#a81724]/5 text-[#2a2426]" : "border-[#d8d3cf] text-stone-600"
              }`}
            >
              <input type="checkbox" className={checkBox} checked={on} onChange={() => toggleGroup(en.code)} />
              {en.name}
            </label>
          );
        })}
      </div>

      {entities
        .filter((en) => groups.includes(en.code))
        .map((en) => {
          const own = branches.filter((b) => b.school_group === en.code);
          const free = own.map((b) => branchKey(en.code, b.name)).filter((k) => !taken[k]);
          const allOn = free.length > 0 && free.every((k) => picked.includes(k));
          return (
            <div key={en.code} className="border border-[#efece9] rounded-md p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#948d88]">{en.name}</p>
                {free.length > 1 && (
                  <button
                    type="button"
                    className="text-xs font-medium text-[#a81724] hover:underline"
                    onClick={() =>
                      onPicked(
                        allOn
                          ? picked.filter((k) => !free.includes(k))
                          : [...new Set([...picked, ...free])]
                      )
                    }
                  >
                    {allOn ? "Clear all" : "Select all"}
                  </button>
                )}
              </div>
              {own.length === 0 ? (
                <p className="text-xs text-stone-400">
                  No active branches. A super admin can add branches under Admin → Branches.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {own.map((b) => {
                    const key = branchKey(en.code, b.name);
                    const reason = taken[key];
                    return (
                      <label
                        key={b.id}
                        className={`flex items-center gap-2 text-sm ${
                          reason ? "text-stone-400 cursor-not-allowed" : "text-stone-700 cursor-pointer"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className={checkBox}
                          disabled={!!reason}
                          checked={!reason && picked.includes(key)}
                          onChange={() => toggleBranch(key)}
                        />
                        <span>
                          {b.name}
                          {reason && <span className="text-[11px]"> ({reason})</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
};

const OpeningsPage = () => {
  const { user, can } = useAuth();
  // Bulk import is granted separately from openings.manage on the Roles page
  const canImport = can("data.import");
  // Scoped admins can only manage openings for their own entities/branches, of
  // which there may be several. A single choice is pinned rather than offered.
  const myGroups = user?.school_groups || [];
  const myBranchNames = (user?.branches || []).map((b) => b.name);
  const scopedGroup = myGroups.length === 1 ? myGroups[0] : null;
  const scopedBranch = myBranchNames.length === 1 ? myBranchNames[0] : null;
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
  // Multi-branch picker: the branches a new opening is posted to, or on edit
  // the extra branches it is copied to
  const [pickGroups, setPickGroups] = useState([]);
  const [picked, setPicked] = useState([]);
  const [filters, setFilters] = useState(noFilters);

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

  // Entities the user may post for
  const entityOptions = entities.filter((en) => !myGroups.length || myGroups.includes(en.code));

  // Active branches for the school group currently selected in the modal,
  // narrowed to the user's own branches when they are branch-scoped
  const branchOptions = branches.filter(
    (b) =>
      b.is_active &&
      b.school_group === form.school_group &&
      (!myBranchNames.length || myBranchNames.includes(b.name))
  );

  // Every active branch the user may post to, across all their entities
  const pickableBranches = branches.filter(
    (b) =>
      b.is_active &&
      entityOptions.some((en) => en.code === b.school_group) &&
      (!myBranchNames.length || myBranchNames.includes(b.name))
  );

  // Branches where this position is already open cannot be picked again
  const taken = {};
  openings
    .filter((o) => o.is_active && form.position && o.position === form.position)
    .forEach((o) => {
      taken[branchKey(o.school_group, o.branch)] = "already open";
    });
  if (editing) taken[branchKey(form.school_group, form.branch)] = "this opening";

  const targets = picked.filter((k) => !taken[k]).map(fromKey);

  // Only positions mapped to the chosen category
  const positionOptions = roleOptions.filter(
    (r) => (r.category || "Academic") === form.category
  );

  // ---- List filters ----
  const setFilter = (key) => (value) =>
    setFilters((f) => ({
      ...f,
      [key]: value,
      // A branch belongs to one entity, so changing the entity drops it
      ...(key === "entity" ? { branch: "" } : {}),
    }));
  const hasFilters = Object.values(filters).some(Boolean);

  const entityName = (code) => entities.find((en) => en.code === code)?.name || code;
  const distinct = (values) => [...new Set(values.filter(Boolean))].sort();

  // Options come from the openings themselves, so every choice has results
  const filterEntities = distinct(openings.map((o) => o.school_group));
  const branchFilterOptions = filterEntities
    .filter((code) => !filters.entity || code === filters.entity)
    .map((code) => ({
      label: entityName(code),
      options: distinct(openings.filter((o) => o.school_group === code).map((o) => o.branch)).map(
        (name) => ({ value: branchKey(code, name), label: name })
      ),
    }));
  const postedByOptions = distinct(openings.map((o) => o.created_by));

  const needle = filters.search.trim().toLowerCase();
  const filtered = openings.filter(
    (o) =>
      (!needle ||
        [o.position, o.branch, o.eligibility].some((v) => (v || "").toLowerCase().includes(needle))) &&
      (!filters.entity || o.school_group === filters.entity) &&
      (!filters.branch || branchKey(o.school_group, o.branch) === filters.branch) &&
      (!filters.category || (o.category || "Academic") === filters.category) &&
      (!filters.curriculum || (o.curriculum || "none") === filters.curriculum) &&
      (!filters.status || (filters.status === "active") === !!o.is_active) &&
      (!filters.postedBy || o.created_by === filters.postedBy)
  );

  const pager = usePagination(filtered, 10);
  const { setPage } = pager;
  // Back to the first page whenever the result set changes shape
  useEffect(() => setPage(1), [filters, setPage]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setPickGroups(scopedGroup ? [scopedGroup] : []);
    // Only pre-picked when there is a single branch to post for
    setPicked(scopedGroup && scopedBranch ? [branchKey(scopedGroup, scopedBranch)] : []);
    setModalOpen(true);
  };

  const openEdit = (opening) => {
    setEditing(opening);
    setPickGroups([]);
    setPicked([]);
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

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "es"}`;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editing && !targets.length) {
      notify.error("Select at least one branch.");
      return;
    }
    setSaving(true);
    try {
      // The server skips branches where the position opened in the meantime
      const skippedNote = (skipped = []) =>
        skipped.length ? ` Skipped ${plural(skipped.length, "branch")} where it is already open.` : "";
      if (editing) {
        const res = await updateOpening(editing.id, { ...form, add_branches: targets });
        const added = res.data.added?.length || 0;
        notify.success(
          (added ? `Opening updated and added to ${plural(added, "branch")}.` : "Opening updated.") +
            skippedNote(res.data.skipped)
        );
      } else {
        const res = await createOpening({ ...form, targets });
        const made = res.data.openings?.length || 1;
        notify.success(
          (made > 1 ? `Opening created at ${plural(made, "branch")}.` : "Opening created.") +
            skippedNote(res.data.skipped)
        );
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
            {hasFilters && <span className="text-[#948d88]"> · {filtered.length} shown</span>}
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
                (!myGroups.length || myGroups.includes(b.school_group)) &&
                (!myBranchNames.length || myBranchNames.includes(b.name))
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

      <FilterBar>
        <SearchPill
          value={filters.search}
          onChange={setFilter("search")}
          placeholder="Search position, branch, description…"
        />
        {filterEntities.length > 1 && (
          <FilterSelect
            value={filters.entity}
            onChange={setFilter("entity")}
            allLabel="All entities"
            options={filterEntities.map((code) => ({ value: code, label: entityName(code) }))}
          />
        )}
        <FilterSelect
          value={filters.branch}
          onChange={setFilter("branch")}
          allLabel="All branches"
          options={
            branchFilterOptions.length === 1 ? branchFilterOptions[0].options : branchFilterOptions
          }
        />
        <FilterSelect
          value={filters.category}
          onChange={setFilter("category")}
          allLabel="All categories"
          className="lg:w-40"
          options={CATEGORIES.map((c) => ({ value: c, label: c }))}
        />
        <FilterSelect
          value={filters.curriculum}
          onChange={setFilter("curriculum")}
          allLabel="Any curriculum"
          className="lg:w-40"
          options={[
            { value: "CBSE", label: "CBSE" },
            { value: "CIE", label: "CIE" },
            { value: "none", label: "No curriculum" },
          ]}
        />
        <FilterSelect
          value={filters.status}
          onChange={setFilter("status")}
          allLabel="Any status"
          className="lg:w-36"
          options={[
            { value: "active", label: "Active" },
            { value: "closed", label: "Closed" },
          ]}
        />
        {postedByOptions.length > 1 && (
          <FilterSelect
            value={filters.postedBy}
            onChange={setFilter("postedBy")}
            allLabel="Posted by anyone"
            options={postedByOptions.map((n) => ({ value: n, label: n }))}
          />
        )}
        {hasFilters && <ResetFilters onClick={() => setFilters(noFilters)} />}
      </FilterBar>

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
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-stone-400">
                  {openings.length ? "No openings match these filters." : "No openings yet."}
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
              {!editing && (
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Entities &amp; branches *
                  </label>
                  <p className="text-xs text-stone-400 mb-2">
                    Pick every branch hiring for this role - each gets its own opening with the
                    same details.
                  </p>
                  <BranchPicker
                    entities={entityOptions}
                    branches={pickableBranches}
                    groups={pickGroups}
                    onGroups={setPickGroups}
                    picked={picked}
                    onPicked={setPicked}
                    taken={taken}
                  />
                  <p className="text-xs text-[#948d88] mt-2">
                    {targets.length ? `${plural(targets.length, "branch")} selected` : "No branches selected"}
                  </p>
                </div>
              )}
              {editing && (
              <>
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
                  {entityOptions.map((en) => (
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
                  disabled={!!scopedBranch}
                  className={`w-full border border-[#d8d3cf] rounded-md px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#a81724]/20 focus:border-[#a81724] ${
                    scopedBranch ? "bg-stone-100 text-stone-500 cursor-not-allowed" : ""
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
                {branchOptions.length === 0 && !scopedBranch && (
                  <p className="text-xs text-stone-400 mt-1">
                    A super admin can add branches under Admin → Branches.
                  </p>
                )}
              </div>
              </>
              )}
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
              {/* A user pinned to one branch has nowhere else to add it */}
              {editing && pickableBranches.length > 1 && (
                <div className="border-t border-[#efece9] pt-4">
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Also open at other branches
                  </label>
                  <p className="text-xs text-stone-400 mb-2">
                    Each branch gets its own opening with the details above. This opening stays at{" "}
                    {form.branch}.
                  </p>
                  <BranchPicker
                    entities={entityOptions}
                    branches={pickableBranches}
                    groups={pickGroups}
                    onGroups={setPickGroups}
                    picked={picked}
                    onPicked={setPicked}
                    taken={taken}
                  />
                  {targets.length > 0 && (
                    <p className="text-xs text-[#948d88] mt-2">
                      Will be added to {plural(targets.length, "branch")}
                    </p>
                  )}
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
                <button type="submit" disabled={saving} className={`${btnDark} flex-1 justify-center`}>
                  {saving
                    ? "Saving…"
                    : editing
                      ? "Save Changes"
                      : targets.length > 1
                        ? `Create ${targets.length} Openings`
                        : "Create Opening"}
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
