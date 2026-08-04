import React, { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { getActiveApplicantId, setActiveApplicantId } from "../applicantSession";
import { useAuth } from "../AuthContext";
import ResumePreview, { useResume } from "../ResumePreview";
import { notify } from "../../components/Toaster";
import { downloadProfilePdf } from "../profilePdf";
import {
  getApplication,
  getActiveFlowOptions,
  getEntities,
  getPublicBranches,
  updateScreening,
  updateInterviewRound,
  updateSuggestedRole,
} from "../../services/api";
import {
  card,
  btnDark,
  btnGhost,
  groupMeta,
  formatDate,
  formatTime,
  formatMobile,
} from "../ui";

const Field = ({ label, children }) => (
  <div>
    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#948d88] mb-1">
      {label}
    </p>
    <div className="text-sm font-medium text-[#2a2426] break-words">{children || "—"}</div>
  </div>
);

const ICONS = {
  back: "M19 12H5 M12 19l-7-7 7-7",
  contact:
    "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z",
  work: "M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  application:
    "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2 M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 M9 12h6 M9 16h6",
  external: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3",
};

const ACTIVITY_META = {
  submitted: { label: "Application Submitted", hex: "#0ea5e9" },
  screening: { label: "Screening Updated", hex: "#a81724" },
  round: { label: "Interview Feedback", hex: "#059669" },
  suggestion: { label: "Role Suggestion", hex: "#d97706" },
};

// ---- Hiring pipeline -------------------------------------------------------

// Fallback when the configured stage list has not loaded yet
const STATUS_META = {
  new: { label: "New", hex: "#0ea5e9" },
  in_process: { label: "In Process", hex: "#78716c" },
  shortlisted: { label: "Shortlisted", hex: "#059669" },
  selected: { label: "Selected", hex: "#1d4ed8" },
  hold: { label: "Hold", hex: "#d97706" },
  not_selected: { label: "Not Selected", hex: "#dc2626" },
};

// Stage options come from Flow Configuration; built-ins cover older data
const stageMeta = (status, stages) => {
  const configured = (stages || []).find((s) => s.key === status);
  if (configured) return { label: configured.label, hex: configured.color };
  return STATUS_META[status] || null;
};

const stageOptions = (stages) =>
  stages && stages.length
    ? stages
    : Object.keys(STATUS_META).map((k) => ({ key: k, label: STATUS_META[k].label }));

const fieldLabel =
  "block text-[11px] font-semibold uppercase tracking-wider text-[#948d88] mb-1";
const fieldInput =
  "w-full bg-stone-100 rounded-xl px-3.5 py-2.5 text-sm text-[#2a2426] outline-none focus:ring-2 focus:ring-[#a81724]/20 transition-shadow";

const StatusBadge = ({ status, stages }) => {
  const m = stageMeta(status, stages);
  if (!m) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0"
      style={{ color: m.hex, backgroundColor: `${m.hex}14` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.hex }} />
      {m.label}
    </span>
  );
};

const StatusSelect = ({ value, onChange, stages }) => {
  const options = stageOptions(stages);
  // A stage deactivated after it was assigned is gone from the list, which
  // would render the field blank and quietly change the candidate's status on
  // the next save. Keep the current value visible and clearly retired.
  const retired = value && !options.some((s) => s.key === value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${fieldInput} cursor-pointer`}
    >
      {retired && (
        <option value={value}>
          {value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} (retired)
        </option>
      )}
      {options.map((s) => (
        <option key={s.key} value={s.key}>
          {s.label}
        </option>
      ))}
    </select>
  );
};

const StageCard = ({ step, title, sub, status, stages, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`${card} p-5`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 text-left"
      >
        <span className="w-7 h-7 rounded-full bg-[#231b1d] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
          {step}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-poppins text-sm font-semibold text-[#2a2426] leading-tight">{title}</h3>
          {sub && <p className="text-[11px] text-[#948d88] mt-0.5">{sub}</p>}
        </div>
        <StatusBadge status={status} stages={stages} />
        <svg
          className={`w-4 h-4 text-[#948d88] shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  );
};

const Toggle = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#948d88]">
      {label}
    </span>
    <span className="flex items-center gap-2 shrink-0">
      <span className={`text-xs font-semibold ${value ? "text-emerald-600" : "text-stone-400"}`}>
        {value ? "Yes" : "No"}
      </span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        aria-pressed={value}
        className={`w-10 h-[22px] rounded-full relative transition-colors ${
          value ? "bg-emerald-500" : "bg-stone-300"
        }`}
      >
        <span
          className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all ${
            value ? "left-[20px]" : "left-0.5"
          }`}
        />
      </button>
    </span>
  </div>
);

const AssigneeSelect = ({ value, onChange, assignees }) => {
  // A previously saved interviewer stays selectable even if deactivated later
  const options =
    value && !assignees.some((o) => o.label === value)
      ? [...assignees, { key: "_legacy", label: value }]
      : assignees;
  return (
    <select className={`${fieldInput} cursor-pointer`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select interviewer</option>
      {options.map((o) => (
        <option key={o.key} value={o.label}>
          {o.label}
        </option>
      ))}
    </select>
  );
};

const SaveButton = ({ saving, disabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={saving || disabled}
    className={`${btnDark} !px-5 !py-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed`}
  >
    {saving ? "Saving…" : "Save"}
  </button>
);

const screeningFormFrom = (a, round1) => ({
  experience: a.screening_experience || a.experience_years || "",
  current_salary: a.screening_current_salary || "",
  expected_salary: a.screening_expected_salary || "",
  location: a.screening_location || "",
  relocate: !!a.screening_relocate,
  comments: a.screening_comments || "",
  status: a.screening_status || "new",
  refer: !!a.referred_entity,
  referred_entity: a.referred_entity || "",
  referred_branch: a.referred_branch || "",
  next_round: !!a.screening_next_round,
  next_assigned_name: round1?.assigned_name || "",
});

const ScreeningCard = ({ a, stages, assignees, entities, branches, round1, onNextRoundLive, onSaved }) => {
  const { user } = useAuth();
  // True when this admin can see the lead only because it was referred to
  // them: their branch is the referral target, not the branch it came from
  const isReceivingBranch =
    !!a.referred_branch &&
    !!user?.branch_name &&
    a.referred_branch === user.branch_name &&
    a.branch !== user.branch_name;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => screeningFormFrom(a, round1));

  useEffect(() => {
    setForm(screeningFormFrom(a, round1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, round1?.assigned_name]);

  // Save stays disabled until something actually changed
  const dirty = JSON.stringify(form) !== JSON.stringify(screeningFormFrom(a, round1));

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const referBranches = branches.filter((b) => b.school_group === form.referred_entity);

  const save = async () => {
    if (form.refer && (!form.referred_entity || !form.referred_branch)) {
      notify.error("Select both an entity and a branch to refer this lead.");
      return;
    }
    setSaving(true);
    try {
      const res = await updateScreening(a.id, {
        ...form,
        referred_entity: form.refer ? form.referred_entity : "",
        referred_branch: form.refer ? form.referred_branch : "",
      });
      onSaved(res.data);
      notify.success("Screening saved.");
    } catch (err) {
      notify.error(err.response?.data?.error || "Could not save screening.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <StageCard step={1} title="Screening" sub="Filled by the recruitment team" status={a.screening_status} stages={stages} defaultOpen>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabel}>Experience</label>
            <input
              className={fieldInput}
              value={form.experience}
              onChange={set("experience")}
              placeholder="e.g. 3 years"
            />
          </div>
          <div>
            <label className={fieldLabel}>Current Salary</label>
            <input
              className={fieldInput}
              value={form.current_salary}
              onChange={set("current_salary")}
              placeholder="e.g. 4.5 LPA"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabel}>Expectation</label>
            <input
              className={fieldInput}
              value={form.expected_salary}
              onChange={set("expected_salary")}
              placeholder="Expected salary"
            />
          </div>
          <div>
            <label className={fieldLabel}>Current Location</label>
            <input
              className={fieldInput}
              value={form.location}
              onChange={set("location")}
              placeholder="e.g. Hyderabad"
            />
          </div>
        </div>
        <Toggle
          label="Willing to Relocate?"
          value={form.relocate}
          onChange={(v) => setForm((f) => ({ ...f, relocate: v }))}
        />
        <div>
          <label className={fieldLabel}>Comments</label>
          <textarea
            className={`${fieldInput} min-h-[70px] resize-y`}
            value={form.comments}
            onChange={set("comments")}
            placeholder="Screening notes…"
          />
        </div>
        <div>
          <label className={fieldLabel}>Profile Status</label>
          <StatusSelect
            value={form.status}
            onChange={(v) => setForm((f) => ({ ...f, status: v }))}
            stages={stages}
          />
        </div>
        <Toggle
          label="Refer to Other Branch?"
          value={form.refer}
          onChange={(v) => {
            // Switching this off removes the referral. For the branch that
            // RECEIVED the lead that also removes their own access to it, so
            // it must not happen on a stray click.
            if (!v && isReceivingBranch) {
              const confirmed = window.confirm(
                "This lead was referred to your branch. Removing the referral will remove it from your list and you will not be able to open it again. Continue?"
              );
              if (!confirmed) return;
            }
            setForm((f) => ({
              ...f,
              refer: v,
              ...(v ? {} : { referred_entity: "", referred_branch: "" }),
            }));
          }}
        />
        {form.refer && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Entity</label>
                <select
                  className={`${fieldInput} cursor-pointer`}
                  value={form.referred_entity}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, referred_entity: e.target.value, referred_branch: "" }))
                  }
                >
                  <option value="">Select entity</option>
                  {entities.map((en) => (
                    <option key={en.code} value={en.code}>
                      {en.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={fieldLabel}>Branch</label>
                <select
                  className={`${fieldInput} cursor-pointer`}
                  value={form.referred_branch}
                  onChange={set("referred_branch")}
                  disabled={!form.referred_entity}
                >
                  <option value="">
                    {form.referred_entity ? "Select branch" : "Select entity first"}
                  </option>
                  {referBranches.map((b) => (
                    <option key={b.id} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-[#948d88]">
              The selected branch's team will see this lead in their applications and can run
              their own interview rounds on it.
            </p>
          </>
        )}
        {/* Interviews stay available on a referred lead - the receiving branch
            runs them without having to remove the referral */}
        <Toggle
          label="Next Interview Round?"
          value={form.next_round}
          onChange={(v) => {
            setForm((f) => ({ ...f, next_round: v }));
            onNextRoundLive(v);
          }}
        />
        {form.next_round && (
          <div>
            <label className={fieldLabel}>Assign To</label>
            <AssigneeSelect
              value={form.next_assigned_name}
              onChange={(v) => setForm((f) => ({ ...f, next_assigned_name: v }))}
              assignees={assignees}
            />
          </div>
        )}
        <SaveButton saving={saving} disabled={!dirty} onClick={save} />
      </div>
    </StageCard>
  );
};

const roundFormFrom = (round, nextRound) => ({
  feedback: round?.feedback || "",
  status: round?.status || "in_process",
  next_round: !!round?.next_round,
  next_assigned_name: nextRound?.assigned_name || "",
});

const RoundCard = ({ step, appId, roundNo, round, nextRound, stages, assignees, allowNext, defaultOpen, onNextRoundLive, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => roundFormFrom(round, nextRound));

  useEffect(() => {
    setForm(roundFormFrom(round, nextRound));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, roundNo, round?.updated_at, nextRound?.assigned_name]);

  // Save stays disabled until something actually changed
  const dirty = JSON.stringify(form) !== JSON.stringify(roundFormFrom(round, nextRound));

  const assignedTo = round?.assigned_name || round?.assigned_to_name || "";

  const save = async () => {
    setSaving(true);
    try {
      const res = await updateInterviewRound(appId, roundNo, form);
      onSaved(res.data);
      notify.success("Interview feedback saved.");
    } catch (err) {
      notify.error(err.response?.data?.error || "Could not save the round.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <StageCard
      step={step}
      title="Interview Feedback"
      sub={`Round ${roundNo}${assignedTo ? ` · Assigned to ${assignedTo}` : ""}`}
      status={round?.status}
      stages={stages}
      defaultOpen={defaultOpen}
    >
      <div className="space-y-3">
        <div>
          <label className={fieldLabel}>Profile Status</label>
          <StatusSelect
            value={form.status}
            onChange={(v) => setForm((f) => ({ ...f, status: v }))}
            stages={stages}
          />
        </div>
        <div>
          <label className={fieldLabel}>Comments</label>
          <textarea
            className={`${fieldInput} min-h-[70px] resize-y`}
            value={form.feedback}
            onChange={(e) => setForm((f) => ({ ...f, feedback: e.target.value }))}
            placeholder="Interview notes…"
          />
        </div>
        {allowNext && (
          <>
            <Toggle
              label="Next Interview Round?"
              value={form.next_round}
              onChange={(v) => {
                setForm((f) => ({ ...f, next_round: v }));
                if (onNextRoundLive) onNextRoundLive(v);
              }}
            />
            {form.next_round && (
              <div>
                <label className={fieldLabel}>Assign To</label>
                <AssigneeSelect
                  value={form.next_assigned_name}
                  onChange={(v) => setForm((f) => ({ ...f, next_assigned_name: v }))}
                  assignees={assignees}
                />
              </div>
            )}
          </>
        )}
        {round?.updated_by_name && (
          <p className="text-[11px] text-[#948d88]">
            Last updated by {round.updated_by_name} · {formatDate(round.updated_at)}
          </p>
        )}
        <SaveButton saving={saving} disabled={!dirty} onClick={save} />
      </div>
    </StageCard>
  );
};

const SuggestedRoleCard = ({ a, roles, step, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(!!a.suggested_role);
  const [value, setValue] = useState(a.suggested_role || "");

  useEffect(() => {
    setEnabled(!!a.suggested_role);
    setValue(a.suggested_role || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id]);

  // A previously saved role stays selectable even if removed from the config
  const roleOptions =
    value && !roles.some((r) => r.label === value)
      ? [...roles, { key: "_legacy", label: value }]
      : roles;

  // Save stays disabled until something actually changed
  const dirty =
    enabled !== !!a.suggested_role || (enabled && value !== (a.suggested_role || ""));

  const save = async () => {
    setSaving(true);
    try {
      const res = await updateSuggestedRole(a.id, { suggested_role: enabled ? value : "" });
      onSaved(res.data);
      notify.success("Suggestion saved.");
    } catch (err) {
      notify.error(err.response?.data?.error || "Could not save the suggestion.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <StageCard step={step} title="Suggested for Different Role" sub="Optional recommendation">
      <div className="space-y-3">
        <Toggle label="Suggested for Different Role?" value={enabled} onChange={setEnabled} />
        {enabled && (
          <div>
            <label className={fieldLabel}>Suggested Role</label>
            <select
              className={`${fieldInput} cursor-pointer`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              <option value="">Select a role</option>
              {roleOptions.map((r) => (
                <option key={r.key} value={r.label}>
                  {r.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-[#948d88] mt-1.5">
              Roles are managed in Flow Configuration.
            </p>
          </div>
        )}
        <SaveButton saving={saving} disabled={!dirty} onClick={save} />
      </div>
    </StageCard>
  );
};

const ApplicantProfilePage = () => {
  const location = useLocation();
  // The id is not in the URL: it comes from the row that was clicked, falling
  // back to the tab's stored id so a refresh keeps working
  const id = location.state?.application?.id || getActiveApplicantId();
  useEffect(() => {
    setActiveApplicantId(id);
  }, [id]);

  // Row data passed from the table renders instantly; the fetch fills/refreshes it
  const [application, setApplication] = useState(location.state?.application || null);
  const [rounds, setRounds] = useState([]);
  const [activity, setActivity] = useState([]);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [flow, setFlow] = useState({ stages: [], assignees: [], suggested_roles: [] });
  const [refData, setRefData] = useState({ entities: [], branches: [] });
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    getApplication(id)
      .then((res) => {
        setApplication(res.data.application);
        setRounds(res.data.rounds || []);
        setActivity(res.data.activity || []);
      })
      .catch((err) => {
        if (!location.state?.application) {
          setNotFound(err.response?.status === 404);
        }
      });
  }, [id, location.state]);

  useEffect(() => {
    getActiveFlowOptions()
      .then((res) =>
        setFlow({
          stages: res.data.stages || [],
          assignees: res.data.assignees || [],
          suggested_roles: res.data.suggested_roles || [],
        })
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    getEntities()
      .then((res) =>
        setRefData((d) => ({ ...d, entities: (res.data.entities || []).filter((e) => e.is_active) }))
      )
      .catch(() => {});
    // The public list is unscoped, so a branch-scoped admin can still refer a
    // lead to another branch (the admin list would only show their own).
    getPublicBranches()
      .then((res) => setRefData((d) => ({ ...d, branches: res.data.branches || [] })))
      .catch(() => {});
  }, []);

  // Loaded once here; the buttons and the preview share the same blob
  const resume = useResume(
    application?.id,
    !!(application?.resume_link || application?.resume_file_id)
  );
  const resumeUrl = resume.url;

  // Live overrides so the round cards follow the toggles instantly;
  // null = follow the saved state
  const [liveGates, setLiveGates] = useState({ screening: null, round1: null });

  // Stage saves return fresh data - keep the page in sync
  const handleReviewSaved = (data) => {
    if (data.application) setApplication(data.application);
    if (data.rounds) setRounds(data.rounds);
    if (data.activity) setActivity(data.activity);
    setLiveGates({ screening: null, round1: null });
  };

  // Landing here without a selected applicant (e.g. a stale bookmark)
  if (!id) return <Navigate to="/admin/applications" replace />;

  if (notFound) {
    return (
      <div className={`${card} p-10 text-center`}>
        <p className="font-poppins text-lg font-semibold text-[#2a2426]">Application not found</p>
        <p className="text-sm text-[#948d88] mt-1">
          It may have been removed or is outside your scope.
        </p>
        <Link to="/admin/applications" className={`${btnDark} mt-5 inline-flex`}>
          Back to applications
        </Link>
      </div>
    );
  }

  if (!application) {
    return (
      <div className={`${card} p-10 text-center text-sm text-[#948d88]`}>Loading applicant…</div>
    );
  }

  const a = application;
  const meta = groupMeta(a.school_group);
  const round1 = rounds.find((r) => r.round_no === 1);
  const round2 = rounds.find((r) => r.round_no === 2);
  // Branch referral: who referred this lead and where to
  const isReferredLead = !!(a.referred_entity && a.referred_branch);
  const referralEvent = isReferredLead
    ? [...activity].reverse().find((ev) => ev.action === "screening" && ev.detail.includes("Referred to"))
    : null;
  const referredEntityName =
    refData.entities.find((e) => e.code === a.referred_entity)?.name || a.referred_entity;
  const showRound1 = liveGates.screening ?? !!a.screening_next_round;
  const showRound2 = showRound1 && (liveGates.round1 ?? !!round1?.next_round);
  const suggestedStep = 2 + (showRound1 ? 1 : 0) + (showRound2 ? 1 : 0);
  const initials = String(a.full_name || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div>
      {/* Back */}
      <Link
        to="/admin/applications"
        className="inline-flex items-center gap-2 text-sm font-semibold text-stone-500 hover:text-[#2a2426] transition-colors mb-4"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={ICONS.back} />
        </svg>
        Applications
      </Link>

      {/* Applicant + application summary - full width so all sections get room */}
      <div className={`${card} p-5 mb-4`}>
        <div className="flex flex-col lg:flex-row gap-5">
        <div
          className={`flex-1 min-w-0 grid grid-cols-1 gap-x-6 gap-y-5 ${
            a.referral_employee_code || a.referral_employee_name
              ? "lg:grid-cols-3"
              : "lg:grid-cols-2"
          }`}
        >
              {/* Left: applicant details */}
              <div>
                <div className="flex items-center gap-4">
                  <span
                    className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
                    style={{ color: meta.hex, backgroundColor: `${meta.hex}14` }}
                  >
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-poppins text-xl font-semibold text-[#2a2426] truncate">
                        {a.full_name}
                      </h2>
                      {isReferredLead && (
                        <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0">
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15 14l5-5-5-5 M20 9H9.5A5.5 5.5 0 0 0 4 14.5V18" />
                          </svg>
                          Referred
                        </span>
                      )}
                    </div>
                    {isReferredLead && (
                      <p className="text-[11px] text-[#948d88] mt-1 leading-relaxed">
                        Referred to <span className="font-semibold text-[#2a2426]">{a.referred_branch}</span> ({referredEntityName})
                        {" "}from {a.branch} ({a.school_group})
                        {referralEvent?.actor_name ? ` · by ${referralEvent.actor_name}` : ""}
                        {referralEvent ? ` on ${formatDate(referralEvent.created_at)}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-4">
                  <a
                    href={`tel:${a.mobile}`}
                    className={`${btnGhost} !px-4 !py-2 text-xs inline-flex items-center gap-1.5`}
                    title="Call"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    <span className="font-mono">{formatMobile(a.mobile)}</span>
                  </a>
                  <a
                    href={`mailto:${a.email}`}
                    className={`${btnGhost} !px-4 !py-2 text-xs inline-flex items-center gap-1.5 min-w-0`}
                    title="Email"
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6l-10 7L2 6" />
                    </svg>
                    <span className="truncate">{a.email}</span>
                  </a>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-[#f0edea]">
                  <Field label="Experience">
                    {a.experience_years
                      ? `${a.experience_years} year${a.experience_years === "1" ? "" : "s"}`
                      : null}
                  </Field>
                  <Field label="Currently Working At">{a.current_company}</Field>
                  {a.qualification ? <Field label="Qualification">{a.qualification}</Field> : null}
                </div>
              </div>

          {/* Right: application details */}
          <div className="border-t border-[#f0edea] pt-5 lg:border-t-0 lg:pt-0 lg:border-l lg:pl-6">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#948d88] mb-4">
              Application
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Position">{a.position}</Field>
              <Field label="Branch">{a.branch}</Field>
              <Field label="School Group">{meta.label}</Field>
              <Field label="Submitted">
                {formatDate(a.created_at)}{" "}
                <span className="font-mono text-xs text-[#948d88]">{formatTime(a.created_at)}</span>
              </Field>
            </div>
          </div>

          {/* Referred by details (when the applicant was referred) */}
          {(a.referral_employee_code || a.referral_employee_name) && (
            <div className="border-t border-[#f0edea] pt-5 lg:border-t-0 lg:pt-0 lg:border-l lg:pl-6">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#948d88] mb-4">
                Referred By
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Employee Name">{a.referral_employee_name}</Field>
                <Field label="Employee ID">
                  {a.referral_employee_code ? (
                    <span className="inline-flex items-center gap-1.5 border border-[#e7e4e1] rounded-full px-2.5 py-1 font-mono text-[12px] bg-[#faf9f8]">
                      <svg className="w-3 h-3 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="9" strokeWidth="1.8" />
                        <path d="M8.5 12.5l2.5 2.5 4.5-5" />
                      </svg>
                      {a.referral_employee_code}
                    </span>
                  ) : null}
                </Field>
                <Field label="Department">{a.referral_employee_branch}</Field>
                <Field label="Mobile">
                  {a.referral_employee_contact ? (
                    <a href={`tel:${a.referral_employee_contact}`} className="font-mono hover:text-[#a81724]">
                      {formatMobile(a.referral_employee_contact)}
                    </a>
                  ) : null}
                </Field>
              </div>
            </div>
          )}
        </div>

        {/* Card actions */}
        <div className="flex flex-row lg:flex-col gap-2 lg:w-44 shrink-0 lg:border-l lg:border-[#f0edea] lg:pl-5 lg:justify-center">
          <button
            type="button"
            onClick={() =>
              downloadProfilePdf({ application: a, rounds, stages: flow.stages })
            }
            className={`${btnDark} !px-4 !py-2.5 text-xs w-full justify-center`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3" />
            </svg>
            Download Profile
          </button>
          <button
            type="button"
            onClick={() => setTimelineOpen(true)}
            className={`${btnGhost} !px-4 !py-2.5 text-xs w-full justify-center`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 3" />
            </svg>
            Timeline
          </button>
        </div>
        </div>
      </div>

      {/* Hiring pipeline (left) · Resume preview (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-4 items-start">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <ScreeningCard
            a={a}
            stages={flow.stages}
            assignees={flow.assignees}
            entities={refData.entities}
            branches={refData.branches}
            round1={round1}
            onNextRoundLive={(v) => setLiveGates((g) => ({ ...g, screening: v }))}
            onSaved={handleReviewSaved}
          />

          {showRound1 && (
            <RoundCard
              step={2}
              appId={a.id}
              roundNo={1}
              round={round1}
              nextRound={round2}
              stages={flow.stages}
              assignees={flow.assignees}
              allowNext
              defaultOpen={liveGates.screening === true}
              onNextRoundLive={(v) => setLiveGates((g) => ({ ...g, round1: v }))}
              onSaved={handleReviewSaved}
            />
          )}

          {showRound2 && (
            <RoundCard
              step={3}
              appId={a.id}
              roundNo={2}
              round={round2}
              stages={flow.stages}
              assignees={flow.assignees}
              defaultOpen={liveGates.round1 === true}
              onSaved={handleReviewSaved}
            />
          )}

          <SuggestedRoleCard
            a={a}
            roles={flow.suggested_roles}
            step={suggestedStep}
            onSaved={handleReviewSaved}
          />
        </div>

        {/* Resume preview */}
        <div className={`${card} lg:col-span-4 lg:sticky lg:top-20 overflow-hidden`}>
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#f0edea]">
            <div className="min-w-0">
              <h3 className="font-poppins text-sm font-semibold text-[#2a2426] truncate">
                Resume Preview
              </h3>
              <p className="text-[11px] text-[#948d88] mt-0.5 truncate">
                {a.full_name} · {a.position}
              </p>
            </div>
            {a.resume_link && (
              <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  // Shares a link to this candidate inside the portal, which
                  // needs a sign-in. The resume itself is no longer a public
                  // URL that could be forwarded outside the organisation.
                  const link = `${window.location.origin}/admin/applications/${a.id}`;
                  try {
                    await navigator.clipboard.writeText(link);
                    notify.success("Profile link copied — colleagues will need to sign in.");
                  } catch {
                    window.prompt("Copy the profile link:", link);
                  }
                }}
                title="Copy a link to this candidate"
                className={`${btnGhost} !px-4 !py-2 text-xs`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <path d="M8.6 13.5l6.8 3.9 M15.4 6.6L8.6 10.5" />
                </svg>
                Share
              </button>
              <a
                href={resumeUrl || undefined}
                download={`${a.full_name} - Resume`}
                aria-disabled={!resumeUrl}
                className={`${btnGhost} !px-4 !py-2 text-xs ${resumeUrl ? "" : "opacity-50 pointer-events-none"}`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3" />
                </svg>
                Download
              </a>
              <a
                href={resumeUrl || undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!resumeUrl}
                className={`${btnDark} !px-4 !py-2 text-xs shrink-0 ${resumeUrl ? "" : "opacity-50 pointer-events-none"}`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={ICONS.external} />
                </svg>
                Open
              </a>
              </div>
            )}
          </div>
          {/* PDF renders natively. Word resumes uploaded before the PDF-only
              rule are rendered in the page, since a browser cannot show one
              in an iframe. */}
          <ResumePreview resume={resume} applicantName={a.full_name} />
        </div>
      </div>

      {/* Timeline drawer */}
      {timelineOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40"
            onClick={() => setTimelineOpen(false)}
          />
          <aside className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-white z-50 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#f0edea]">
              <div className="min-w-0">
                <h3 className="font-poppins text-base font-semibold text-[#2a2426]">Timeline</h3>
                <p className="text-[11px] text-[#948d88] mt-0.5 truncate">
                  {a.full_name} · {a.position}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTimelineOpen(false)}
                aria-label="Close timeline"
                className="w-9 h-9 rounded-full flex items-center justify-center text-[#948d88] hover:text-[#2a2426] hover:bg-stone-100 transition-colors shrink-0"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-6">
              {activity.length === 0 ? (
                <p className="text-sm text-[#948d88] text-center py-10">No activity recorded yet.</p>
              ) : (
                <ol className="relative border-l-2 border-[#efece9] ml-2">
                  {activity.map((ev) => {
                    const meta = ACTIVITY_META[ev.action] || {
                      label: ev.action,
                      hex: "#78716c",
                    };
                    return (
                      <li key={ev.id} className="relative pl-6 pb-6 last:pb-1">
                        <span
                          className="absolute -left-[7px] top-1 w-3 h-3 rounded-full ring-4 ring-white"
                          style={{ backgroundColor: meta.hex }}
                        />
                        <p className="text-sm font-semibold text-[#2a2426] leading-tight">
                          {meta.label}
                        </p>
                        {ev.detail && (
                          <p className="text-xs text-stone-600 mt-1 leading-relaxed">{ev.detail}</p>
                        )}
                        <p className="text-[11px] text-[#948d88] mt-1">
                          {ev.actor_name ? `${ev.actor_name} · ` : ""}
                          {formatDate(ev.created_at)}{" "}
                          <span className="font-mono">{formatTime(ev.created_at)}</span>
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
};

export default ApplicantProfilePage;
