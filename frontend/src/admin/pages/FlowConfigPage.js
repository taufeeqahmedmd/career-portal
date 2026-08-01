import React, { useEffect, useState } from "react";
import { notify } from "../../components/Toaster";
import {
  getFlowOptions,
  createFlowOption,
  updateFlowOption,
  deleteFlowOption,
  importFlowOptionsCsv,
} from "../../services/api";
import ImportCsvModal from "../ImportCsvModal";
import { useAuth } from "../AuthContext";
import { PageHeader, card, btnDark, btnGhost } from "../ui";

const inputClass =
  "w-full bg-stone-100 rounded-xl px-3.5 py-2.5 text-sm text-[#2a2426] outline-none focus:ring-2 focus:ring-[#a81724]/20 transition-shadow";

const TrashIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M10 11v6 M14 11v6" />
  </svg>
);

const LockIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

const CATEGORIES = ["Academic", "Non-Academic"];

const OptionRow = ({ option, withColor, withCategory, onChanged }) => {
  const [label, setLabel] = useState(option.label);
  const [color, setColor] = useState(option.color);
  const [busy, setBusy] = useState(false);

  useEffect(() => setLabel(option.label), [option.label]);
  useEffect(() => setColor(option.color), [option.color]);

  const patch = async (data, successMsg) => {
    setBusy(true);
    try {
      await updateFlowOption(option.id, data);
      onChanged();
      if (successMsg) notify.success(successMsg);
    } catch (err) {
      notify.error(err.response?.data?.error || "Update failed.");
      setLabel(option.label);
    } finally {
      setBusy(false);
    }
  };

  const saveLabel = () => {
    const next = label.trim();
    if (!next) {
      setLabel(option.label);
      return;
    }
    if (next !== option.label) patch({ label: next }, "Value renamed.");
  };

  const remove = async () => {
    // Matches the confirm step on the Branches and Entities pages
    if (!window.confirm(`Remove "${option.label}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteFlowOption(option.id);
      onChanged();
      notify.success("Value removed.");
    } catch (err) {
      notify.error(err.response?.data?.error || "Could not remove the value.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`flex items-center gap-2.5 rounded-xl border border-[#efece9] px-3 py-2 ${
        option.is_active ? "bg-white" : "bg-stone-50 opacity-70"
      }`}
    >
      {withColor && (
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          // Saving on blur, not on change: dragging inside the picker fires a
          // change event per frame, which would be one PUT + reload each
          onBlur={() => color !== option.color && patch({ color }, "Color updated.")}
          disabled={busy}
          title="Badge color"
          className="w-6 h-6 rounded-full border-0 bg-transparent cursor-pointer shrink-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
        />
      )}
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={saveLabel}
        onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
        disabled={busy}
        className="flex-1 min-w-0 bg-transparent text-sm font-medium text-[#2a2426] outline-none focus:bg-stone-50 rounded-lg px-2 py-1"
      />

      {withCategory && (
        <select
          value={option.category || "Academic"}
          onChange={(e) => patch({ category: e.target.value }, "Category updated.")}
          disabled={busy}
          title="Used to filter positions when posting an opening"
          className="shrink-0 bg-stone-100 rounded-lg px-2 py-1 text-[11px] font-semibold text-stone-600 outline-none cursor-pointer focus:ring-2 focus:ring-[#a81724]/20"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}

      {option.is_system ? (
        <span
          className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#948d88] shrink-0"
          title="Required by the flow logic - always active"
        >
          <LockIcon />
          System
        </span>
      ) : (
        <>
          {/* Active toggle */}
          <button
            type="button"
            onClick={() => patch({ is_active: !option.is_active })}
            disabled={busy}
            title={option.is_active ? "Deactivate (hide from dropdowns)" : "Activate"}
            className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${
              option.is_active ? "bg-emerald-500" : "bg-stone-300"
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                option.is_active ? "left-[18px]" : "left-0.5"
              }`}
            />
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            title="Delete value"
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#948d88] hover:text-[#dc2626] hover:bg-red-50 transition-colors shrink-0"
          >
            <TrashIcon />
          </button>
        </>
      )}
    </div>
  );
};

const OptionSection = ({
  title,
  hint,
  type,
  items,
  withColor,
  withCategory,
  placeholder,
  scroll,
  onChanged,
}) => {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#78716c");
  const [category, setCategory] = useState("Academic");
  const [adding, setAdding] = useState(false);

  const add = async () => {
    const value = label.trim();
    if (!value) return;
    setAdding(true);
    try {
      await createFlowOption({
        type,
        label: value,
        ...(withColor ? { color } : {}),
        ...(withCategory ? { category } : {}),
      });
      setLabel("");
      onChanged();
      notify.success("Value added.");
    } catch (err) {
      notify.error(err.response?.data?.error || "Could not add the value.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className={`${card} p-5`}>
      <h3 className="font-poppins text-sm font-semibold text-[#2a2426]">{title}</h3>
      <p className="text-xs text-[#948d88] mt-0.5 mb-4">{hint}</p>

      <div
        className={`flex flex-col gap-2 ${
          scroll ? "max-h-[26rem] overflow-y-auto -mr-1 pr-1" : ""
        }`}
      >
        {items.map((o) => (
          <OptionRow
            key={o.id}
            option={o}
            withColor={withColor}
            withCategory={withCategory}
            onChanged={onChanged}
          />
        ))}
        {items.length === 0 && (
          <p className="text-sm text-[#948d88] py-4 text-center">No values yet - add one below.</p>
        )}
      </div>

      {/* Add new */}
      <div className="flex items-center gap-2 mt-4">
        {withColor && (
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            title="Badge color"
            className="w-8 h-8 rounded-full border-0 bg-transparent cursor-pointer shrink-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
          />
        )}
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={placeholder || (withColor ? "New status, e.g. Offer Released" : "New value")}
          className={inputClass}
        />
        {withCategory && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            title="Category for the new role"
            className="shrink-0 bg-stone-100 rounded-xl px-3 py-2.5 text-xs font-semibold text-stone-600 outline-none cursor-pointer focus:ring-2 focus:ring-[#a81724]/20"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <button onClick={add} disabled={adding || !label.trim()} className={`${btnDark} !px-5 !py-2.5 text-xs shrink-0 disabled:opacity-60`}>
          {adding ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
};

const FlowConfigPage = () => {
  const { can } = useAuth();
  // Bulk import is granted separately from flow.manage on the Roles page
  const canImport = can("data.import");
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);

  const load = () => {
    getFlowOptions()
      .then((res) => setOptions(res.data.options))
      .catch(() => notify.error("Failed to load flow configuration."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const stages = options.filter((o) => o.type === "profile_stage");
  const assignees = options.filter((o) => o.type === "assignee");
  const suggestedRoles = options.filter((o) => o.type === "suggested_role");

  return (
    <div>
      <PageHeader
        eyebrow="Careers · Setup"
        title="Flow Configuration"
        sub={<p className="text-[#948d88]">Dropdown values used in the hiring pipeline on applicant profiles</p>}
        actions={
          canImport ? (
            <button onClick={() => setImportOpen(true)} className={btnGhost}>
              Import CSV
            </button>
          ) : null
        }
      />

      {importOpen && (
        <ImportCsvModal
          title="Import Roles / Positions"
          description="Values that already exist are skipped, so re-running a file only adds what is new."
          columns={[
            { name: "label", required: true, note: "The role or position name, e.g. PRT - English." },
            {
              name: "type",
              note: "suggested_role (default), assignee or profile_stage.",
            },
            { name: "color", note: "Hex value like #059669. Used by profile stages." },
            {
              name: "category",
              note: "Academic (default) or Non-Academic. Decides which openings a role appears under.",
            },
          ]}
          sample={[
            "PRT - English,suggested_role,,Academic",
            "Lab Assistant,suggested_role,,Non-Academic",
          ]}
          onImport={importFlowOptionsCsv}
          onClose={() => setImportOpen(false)}
          onDone={load}
        />
      )}

      {loading ? (
        <div className={`${card} p-10 text-center text-sm text-[#948d88]`}>Loading…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* Pipeline settings stack on the left */}
          <div className="flex flex-col gap-4">
            <OptionSection
              title="Profile Stage"
              hint="Statuses available in Screening and Interview rounds. System values are defaults the flow relies on and stay active."
              type="profile_stage"
              items={stages}
              withColor
              onChanged={load}
            />
            <OptionSection
              title="Assign To"
              hint="Interviewers that can be assigned to an interview round."
              type="assignee"
              items={assignees}
              placeholder="New interviewer, e.g. Principal - Nacharam"
              onChanged={load}
            />
          </div>

          {/* The roles list grows longest, so it scrolls inside its card */}
          <OptionSection
            title="Roles / Positions"
            hint='Used for the Position dropdown when posting a job opening, and for "Suggested for Different Role" on applicant profiles.'
            type="suggested_role"
            items={suggestedRoles}
            placeholder="New role, e.g. PRT - English"
            withCategory
            scroll
            onChanged={load}
          />
        </div>
      )}
    </div>
  );
};

export default FlowConfigPage;
