import React, { useEffect, useState, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { notify } from "../../components/Toaster";
import {
  getApplications,
  exportApplicationsCsv,
  requestExportOtp,
  getAdminOpenings,
  getApplicationStats,
  getEntities,
  getPublicBranches,
  getActiveFlowOptions,
} from "../../services/api";
import { useAuth } from "../AuthContext";
import { setActiveApplicantId } from "../applicantSession";
import {
  PageHeader,
  GroupBadge,
  Avatar,
  groupMeta,
  registerEntities,
  btnDark,
  thBase,
  card,
  formatDate,
  formatTime,
  formatMobile,
  Pagination,
} from "../ui";

const ApplicationsPage = () => {
  const { user } = useAuth();
  // Scoped admins only see their own school group; the backend enforces this too
  // Scope now comes from the user's assigned entity/branch, independent of role
  const isScoped = !!user?.school_group;
  const [applications, setApplications] = useState([]);
  const [openings, setOpenings] = useState([]);
  const [entities, setEntities] = useState([]);
  const [stats, setStats] = useState(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpInfo, setOtpInfo] = useState(null);
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");

  const [search, setSearch] = useState("");
  const [schoolGroups, setSchoolGroups] = useState([]); // multi-select; empty = all
  const [position, setPosition] = useState("");
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState([]);
  // Dashboard cards deep-link here with ?status=… / ?referred=1
  const [searchParams] = useSearchParams();
  const [statuses, setStatuses] = useState(() => {
    const s = searchParams.get("status");
    return s ? s.split(",").filter(Boolean) : [];
  });
  const [stageOptions, setStageOptions] = useState([]);
  const [referred, setReferred] = useState(() => searchParams.get("referred") || ""); // '' | '1' | '0'
  const [sources, setSources] = useState(() => {
    const s = searchParams.get("source");
    return s ? s.split(",").filter(Boolean) : [];
  });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("created_at"); // 'created_at' | 'last_activity'
  const [order, setOrder] = useState("desc"); // 'asc' | 'desc'
  const [openMenu, setOpenMenu] = useState(null); // 'groups' | 'status' | 'referred' | 'dates' | null
  const toolbarRef = useRef(null);

  // Close filter popovers on outside click
  useEffect(() => {
    const onDown = (e) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const buildParams = useCallback(
    (extra = {}) => {
      const params = { page, limit: 20, ...extra };
      if (search.trim()) params.search = search.trim();
      if (schoolGroups.length) params.school_group = schoolGroups.join(",");
      if (position) params.position = position;
      if (branch) params.branch = branch;
      if (statuses.length) params.status = statuses.join(",");
      if (referred) params.referred = referred;
      if (sources.length) params.source = sources.join(",");
      if (from) params.from = from;
      if (to) params.to = to;
      params.sort = sort;
      params.order = order;
      return params;
    },
    [page, search, schoolGroups, position, branch, statuses, referred, sources, from, to, sort, order]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getApplications(buildParams());
      setApplications(res.data.applications);
      setTotal(res.data.total);
      setTotalPages(res.data.totalPages || 1);
    } catch {
      notify.error("Failed to load applications.");
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getAdminOpenings()
      .then((res) => setOpenings(res.data.openings))
      .catch(() => {});
    getApplicationStats()
      .then((res) => setStats(res.data))
      .catch(() => {});
    getEntities()
      .then((res) => {
        registerEntities(res.data.entities);
        setEntities(res.data.entities.filter((en) => en.is_active));
      })
      .catch(() => {});
    getPublicBranches()
      .then((res) => setBranches(res.data.branches))
      .catch(() => {});
    getActiveFlowOptions()
      .then((res) => setStageOptions(res.data.stages || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, schoolGroups, position, branch, statuses, referred, sources, from, to]);

  // Deselect the branch when the group filter no longer includes its entity
  useEffect(() => {
    if (!branch || schoolGroups.length === 0) return;
    const selected = branches.find((b) => b.name === branch);
    if (selected && !schoolGroups.includes(selected.school_group)) {
      setBranch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolGroups]);

  // Exports are approved by a super admin: request a code, then redeem it
  const handleExportRequest = async () => {
    setExporting(true);
    try {
      const res = await requestExportOtp(buildParams({ page: undefined, limit: undefined }));
      setOtpInfo(res.data);
      setOtp("");
      setOtpError("");
      setOtpOpen(true);
    } catch (err) {
      notify.error(err.response?.data?.error || "Could not request an approval code.");
    } finally {
      setExporting(false);
    }
  };

  const handleExportDownload = async () => {
    setExporting(true);
    setOtpError("");
    try {
      const res = await exportApplicationsCsv(
        buildParams({ page: undefined, limit: undefined, otp })
      );
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "applications.csv";
      a.click();
      URL.revokeObjectURL(url);
      setOtpOpen(false);
      notify.success("Export downloaded.");
    } catch (err) {
      // The error body arrives as a Blob because the request expects a file
      let message = "Export failed.";
      try {
        message = JSON.parse(await err.response.data.text()).error || message;
      } catch {}
      setOtpError(message);
    } finally {
      setExporting(false);
    }
  };

  const grand = stats?.total ?? total;
  // Distinct position names for the positions dropdown
  const positionOptions = [...new Set(openings.map((o) => o.position).filter(Boolean))].sort();

  // Branch options grouped by entity; scoped users only see their own group,
  // and the group multi-select narrows the list (empty selection = all groups)
  const branchGroups = entities
    .filter((en) => !isScoped || user.school_group === en.code)
    .filter((en) => schoolGroups.length === 0 || schoolGroups.includes(en.code))
    .map((en) => ({
      code: en.code,
      label: en.name,
      items: branches.filter((b) => b.school_group === en.code),
    }))
    .filter((g) => g.items.length > 0);

  const toggleGroup = (code) =>
    setSchoolGroups((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );

  const toggleStatus = (key) =>
    setStatuses((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));

  // Stage lookup for badges and the filter label (falls back to the raw key)
  const stageMeta = (key) => {
    const s = stageOptions.find((o) => o.key === key);
    if (s) return { label: s.label, hex: s.color };
    if (!key) return null;
    return { label: key.replace(/_/g, " "), hex: "#78716c" };
  };

  const statusLabel =
    statuses.length === 0
      ? "All statuses"
      : statuses.length === 1
        ? stageMeta(statuses[0])?.label || statuses[0]
        : `${statuses.length} statuses`;

  const toggleSource = (name) =>
    setSources((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]));

  // Sources seen in the data, plus any that are filtered but currently absent
  const sourceOptions = [
    ...new Set([...Object.keys(stats?.bySource || {}), ...sources, "Website"]),
  ].sort((a, b) => (stats?.bySource?.[b] ?? 0) - (stats?.bySource?.[a] ?? 0) || a.localeCompare(b));

  const sourceLabel =
    sources.length === 0 ? "All sources" : sources.length === 1 ? sources[0] : `${sources.length} sources`;

  // Clicking a sortable header toggles direction, or switches column (newest first)
  const applySort = (key) => {
    if (sort === key) {
      setOrder((o) => (o === "desc" ? "asc" : "desc"));
    } else {
      setSort(key);
      setOrder("desc");
    }
    setPage(1);
  };

  const SortHeader = ({ label, sortKey }) => {
    const active = sort === sortKey;
    return (
      <th className={thBase}>
        <button
          type="button"
          onClick={() => applySort(sortKey)}
          title={
            active
              ? order === "desc"
                ? "Sorted newest first — click for oldest first"
                : "Sorted oldest first — click for newest first"
              : `Sort by ${label.toLowerCase()}`
          }
          className={`inline-flex items-center gap-1.5 transition-colors ${
            active ? "text-[#a81724]" : "hover:text-[#2a2426]"
          }`}
        >
          {label}
          <span className="flex flex-col leading-none">
            <svg
              className={`w-2.5 h-2.5 -mb-0.5 ${
                active && order === "asc" ? "text-[#a81724]" : "text-stone-300"
              }`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 6l6 8H6z" />
            </svg>
            <svg
              className={`w-2.5 h-2.5 ${
                active && order === "desc" ? "text-[#a81724]" : "text-stone-300"
              }`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 18l-6-8h12z" />
            </svg>
          </span>
        </button>
      </th>
    );
  };

  // Date-range helpers (local calendar dates as YYYY-MM-DD)
  const localIso = (d) => d.toLocaleDateString("en-CA");
  const applyPreset = (daysBack, monthStart = false) => {
    const now = new Date();
    if (monthStart) {
      setFrom(localIso(new Date(now.getFullYear(), now.getMonth(), 1)));
    } else {
      setFrom(localIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack)));
    }
    setTo(localIso(now));
  };
  const fmtShort = (s) =>
    s
      ? new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
      : "";
  const dateLabel =
    from && to
      ? from === to
        ? fmtShort(from)
        : `${fmtShort(from)} – ${fmtShort(to)}`
      : from
        ? `From ${fmtShort(from)}`
        : to
          ? `Until ${fmtShort(to)}`
          : "Any date";

  const groupsLabel =
    schoolGroups.length === 0
      ? "All groups"
      : schoolGroups.length === 1
        ? groupMeta(schoolGroups[0]).short
        : `${schoolGroups.length} groups`;

  const hasFilters = !!(
    search.trim() ||
    schoolGroups.length ||
    position ||
    branch ||
    statuses.length ||
    referred ||
    sources.length ||
    from ||
    to
  );
  const clearFilters = () => {
    setSearch("");
    setSchoolGroups([]);
    setPosition("");
    setBranch("");
    setStatuses([]);
    setReferred("");
    setSources([]);
    setFrom("");
    setTo("");
    setOpenMenu(null);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Careers · Intake"
        title="Applications"
        sub={
          <p>
            <span className="text-[#dc2626] font-semibold">
              {total} of {grand} shown
            </span>
            <span className="text-[#948d88]">
              {" · "}
              {sort === "last_activity" ? "last activity" : "submitted"}
              {order === "desc" ? " — newest first" : " — oldest first"}
            </span>
          </p>
        }
        actions={
          <button
            onClick={handleExportRequest}
            disabled={exporting || total === 0}
            title="A super admin must approve this export"
            className={btnDark}
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3" />
            </svg>
            {exporting && !otpOpen ? "Requesting…" : "Export CSV"}
          </button>
        }
      />

      {/* Export approval: super admin receives the code by email */}
      {otpOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40"
            onClick={() => setOtpOpen(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className={`${card} p-6 w-full max-w-md pointer-events-auto`}>
              <div className="flex items-start gap-3 mb-4">
                <span className="w-10 h-10 rounded-full bg-[#a81724]/10 text-[#a81724] flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <h3 className="font-poppins text-base font-semibold text-[#2a2426]">
                    Approval required
                  </h3>
                  <p className="text-xs text-[#948d88] mt-1 leading-relaxed">
                    A one-time code was emailed to{" "}
                    <span className="font-semibold text-[#2a2426]">
                      {otpInfo?.sent_to?.join(", ")}
                    </span>
                    . Enter it below to download{" "}
                    <span className="font-semibold text-[#2a2426]">
                      {otpInfo?.rows} application{otpInfo?.rows === 1 ? "" : "s"}
                    </span>
                    .
                  </p>
                </div>
              </div>

              <input
                type="text"
                inputMode="numeric"
                autoFocus
                maxLength={6}
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value.replace(/\D/g, ""));
                  setOtpError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && otp.length === 6 && handleExportDownload()}
                placeholder="000000"
                className="w-full bg-stone-100 rounded-xl px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] text-[#2a2426] outline-none focus:ring-2 focus:ring-[#a81724]/20 transition-shadow"
              />
              {otpError && <p className="text-xs text-[#dc2626] mt-2">{otpError}</p>}
              <p className="text-[11px] text-[#948d88] mt-2">
                Expires in {otpInfo?.expires_in_minutes} minutes · single use
              </p>

              <div className="flex items-center gap-2 mt-5">
                <button
                  onClick={handleExportDownload}
                  disabled={exporting || otp.length !== 6}
                  className={`${btnDark} !px-5 !py-2.5 text-sm disabled:opacity-50`}
                >
                  {exporting ? "Verifying…" : "Download CSV"}
                </button>
                <button
                  onClick={() => setOtpOpen(false)}
                  className="px-5 py-2.5 rounded-full text-sm font-semibold text-stone-600 hover:bg-stone-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Filter toolbar */}
      <div ref={toolbarRef} className={`${card} p-3 sm:p-4 mb-5`}>
        <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-2.5">
          {/* Search pill */}
          <div className="flex items-center gap-2.5 flex-1 min-w-0 lg:min-w-[240px] bg-stone-100 rounded-full px-4 h-11 focus-within:ring-2 focus-within:ring-[#a81724]/20 transition-shadow">
            <svg
              className="w-4 h-4 text-[#948d88] shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, mobile, referral code…"
              className="flex-1 min-w-0 bg-transparent outline-none text-sm text-[#2a2426] placeholder:text-[#948d88]"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="w-6 h-6 rounded-full bg-stone-200 hover:bg-stone-300 text-stone-500 flex items-center justify-center text-xs transition-colors shrink-0"
              >
                ✕
              </button>
            )}
          </div>

          {/* Position select (distinct position names) */}
          <div className="relative flex items-center bg-stone-100 rounded-full h-11 lg:w-52 focus-within:ring-2 focus-within:ring-[#a81724]/20 transition-shadow">
            <svg
              className="w-4 h-4 text-[#948d88] absolute left-4 pointer-events-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="appearance-none w-full bg-transparent outline-none text-sm font-medium text-[#2a2426] pl-10 pr-9 cursor-pointer"
            >
              <option value="">All positions</option>
              {positionOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <svg
              className="w-3.5 h-3.5 text-[#948d88] absolute right-4 pointer-events-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>

          {/* Branch select, grouped by entity */}
          <div className="relative flex items-center bg-stone-100 rounded-full h-11 lg:w-52 focus-within:ring-2 focus-within:ring-[#a81724]/20 transition-shadow">
            <svg
              className="w-4 h-4 text-[#948d88] absolute left-4 pointer-events-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 21h18 M5 21V7l7-4v18 M19 21V11l-7-4 M9 9v.01 M9 12v.01 M9 15v.01 M9 18v.01" />
            </svg>
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="appearance-none w-full bg-transparent outline-none text-sm font-medium text-[#2a2426] pl-10 pr-9 cursor-pointer"
            >
              <option value="">All branches</option>
              {branchGroups.map((bg) => (
                <optgroup key={bg.code} label={bg.label}>
                  {bg.items.map((b) => (
                    <option key={`${bg.code}-${b.name}`} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <svg
              className="w-3.5 h-3.5 text-[#948d88] absolute right-4 pointer-events-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>

          {/* Groups multi-select dropdown */}
          {!isScoped && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu((m) => (m === "groups" ? null : "groups"))}
                className={`flex items-center gap-2.5 h-11 px-4 rounded-full text-sm font-medium transition-colors ${
                  schoolGroups.length
                    ? "bg-[#231b1d] text-white"
                    : "bg-stone-100 text-[#2a2426] hover:bg-stone-200/70"
                }`}
              >
                <span className="flex -space-x-1">
                  {(schoolGroups.length ? schoolGroups : entities.map((e) => e.code))
                    .slice(0, 3)
                    .map((code) => (
                      <span
                        key={code}
                        className="w-2.5 h-2.5 rounded-full ring-2 ring-white/90"
                        style={{ backgroundColor: groupMeta(code).hex }}
                      />
                    ))}
                </span>
                {groupsLabel}
                <svg
                  className={`w-3.5 h-3.5 transition-transform ${
                    openMenu === "groups" ? "rotate-180" : ""
                  }`}
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

              {openMenu === "groups" && (
                <div className="absolute z-30 mt-2 left-0 w-64 bg-white rounded-2xl border border-[#e7e4e1] shadow-xl p-2">
                  <button
                    onClick={() => setSchoolGroups([])}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-[#2a2426] hover:bg-stone-50 transition-colors"
                  >
                    <span className="flex-1 text-left">All groups</span>
                    {schoolGroups.length === 0 && (
                      <svg
                        className="w-4 h-4 text-[#a81724]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                  <div className="h-px bg-[#f0edea] my-1 mx-2" />
                  {entities.map((en) => {
                    const checked = schoolGroups.includes(en.code);
                    return (
                      <button
                        key={en.code}
                        onClick={() => toggleGroup(en.code)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm hover:bg-stone-50 transition-colors"
                      >
                        <span
                          className={`w-[18px] h-[18px] rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                            checked
                              ? "bg-[#231b1d] border-[#231b1d]"
                              : "bg-white border-stone-300"
                          }`}
                        >
                          {checked && (
                            <svg
                              className="w-3 h-3 text-white"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          )}
                        </span>
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: en.color }}
                        />
                        <span className="flex-1 text-left font-medium text-[#2a2426] truncate">
                          {en.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Profile status multi-select dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu((m) => (m === "status" ? null : "status"))}
              className={`flex items-center gap-2.5 h-11 px-4 rounded-full text-sm font-medium transition-colors ${
                statuses.length
                  ? "bg-[#231b1d] text-white"
                  : "bg-stone-100 text-[#2a2426] hover:bg-stone-200/70"
              }`}
            >
              <svg
                className="w-4 h-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3" />
              </svg>
              {statusLabel}
              <svg
                className={`w-3.5 h-3.5 transition-transform ${
                  openMenu === "status" ? "rotate-180" : ""
                }`}
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

            {openMenu === "status" && (
              <div className="absolute z-30 mt-2 left-0 w-64 bg-white rounded-2xl border border-[#e7e4e1] shadow-xl p-2">
                <button
                  onClick={() => setStatuses([])}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-[#2a2426] hover:bg-stone-50 transition-colors"
                >
                  <span className="flex-1 text-left">All statuses</span>
                  {statuses.length === 0 && (
                    <svg
                      className="w-4 h-4 text-[#a81724]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </button>
                <div className="h-px bg-[#f0edea] my-1 mx-2" />
                {stageOptions.map((s) => {
                  const checked = statuses.includes(s.key);
                  const count = stats?.byStage?.[s.key];
                  return (
                    <button
                      key={s.key}
                      onClick={() => toggleStatus(s.key)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm hover:bg-stone-50 transition-colors"
                    >
                      <span
                        className={`w-[18px] h-[18px] rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                          checked ? "bg-[#231b1d] border-[#231b1d]" : "bg-white border-stone-300"
                        }`}
                      >
                        {checked && (
                          <svg
                            className="w-3 h-3 text-white"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </span>
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="flex-1 text-left font-medium text-[#2a2426] truncate">
                        {s.label}
                      </span>
                      {count != null && (
                        <span className="font-mono text-[11px] text-[#948d88]">{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Referral handoff filter */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu((m) => (m === "referred" ? null : "referred"))}
              className={`flex items-center gap-2 h-11 px-4 rounded-full text-sm font-medium transition-colors ${
                referred
                  ? "bg-[#231b1d] text-white"
                  : "bg-stone-100 text-[#2a2426] hover:bg-stone-200/70"
              }`}
            >
              <svg
                className="w-4 h-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 14l5-5-5-5 M20 9H9.5A5.5 5.5 0 0 0 4 14.5V18" />
              </svg>
              {referred === "1" ? "Referred only" : referred === "0" ? "Not referred" : "Referral"}
              <svg
                className={`w-3.5 h-3.5 transition-transform ${
                  openMenu === "referred" ? "rotate-180" : ""
                }`}
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

            {openMenu === "referred" && (
              <div className="absolute z-30 mt-2 left-0 w-60 bg-white rounded-2xl border border-[#e7e4e1] shadow-xl p-2">
                {[
                  { value: "", label: "All applications", count: stats?.total },
                  { value: "1", label: "Referred to other branch", count: stats?.referred },
                  {
                    value: "0",
                    label: "Not referred",
                    count:
                      stats?.total != null && stats?.referred != null
                        ? stats.total - stats.referred
                        : undefined,
                  },
                ].map((opt) => (
                  <button
                    key={opt.value || "all"}
                    onClick={() => {
                      setReferred(opt.value);
                      setOpenMenu(null);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm hover:bg-stone-50 transition-colors"
                  >
                    <span className="flex-1 text-left font-medium text-[#2a2426] truncate">
                      {opt.label}
                    </span>
                    {opt.count != null && (
                      <span className="font-mono text-[11px] text-[#948d88]">{opt.count}</span>
                    )}
                    {referred === opt.value && (
                      <svg
                        className="w-4 h-4 text-[#a81724] shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Traffic source multi-select dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu((m) => (m === "source" ? null : "source"))}
              className={`flex items-center gap-2 h-11 px-4 rounded-full text-sm font-medium transition-colors ${
                sources.length
                  ? "bg-[#231b1d] text-white"
                  : "bg-stone-100 text-[#2a2426] hover:bg-stone-200/70"
              }`}
            >
              <svg
                className="w-4 h-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 12v8h16v-8 M12 3v13 M8 7l4-4 4 4" />
              </svg>
              {sourceLabel}
              <svg
                className={`w-3.5 h-3.5 transition-transform ${
                  openMenu === "source" ? "rotate-180" : ""
                }`}
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

            {openMenu === "source" && (
              <div className="absolute z-30 mt-2 left-0 w-64 bg-white rounded-2xl border border-[#e7e4e1] shadow-xl p-2">
                <button
                  onClick={() => setSources([])}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-[#2a2426] hover:bg-stone-50 transition-colors"
                >
                  <span className="flex-1 text-left">All sources</span>
                  {sources.length === 0 && (
                    <svg
                      className="w-4 h-4 text-[#a81724]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </button>
                <div className="h-px bg-[#f0edea] my-1 mx-2" />
                <div className="max-h-64 overflow-y-auto">
                  {sourceOptions.map((name) => {
                    const checked = sources.includes(name);
                    const count = stats?.bySource?.[name];
                    return (
                      <button
                        key={name}
                        onClick={() => toggleSource(name)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm hover:bg-stone-50 transition-colors"
                      >
                        <span
                          className={`w-[18px] h-[18px] rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                            checked ? "bg-[#231b1d] border-[#231b1d]" : "bg-white border-stone-300"
                          }`}
                        >
                          {checked && (
                            <svg
                              className="w-3 h-3 text-white"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          )}
                        </span>
                        <span className="flex-1 text-left font-medium text-[#2a2426] truncate">
                          {name}
                        </span>
                        {count != null && (
                          <span className="font-mono text-[11px] text-[#948d88]">{count}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Date range dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu((m) => (m === "dates" ? null : "dates"))}
              className={`flex items-center gap-2 h-11 px-4 rounded-full text-sm font-medium transition-colors ${
                from || to
                  ? "bg-[#231b1d] text-white"
                  : "bg-stone-100 text-[#2a2426] hover:bg-stone-200/70"
              }`}
            >
              <svg
                className="w-4 h-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4 M8 2v4 M3 10h18" />
              </svg>
              {dateLabel}
              <svg
                className={`w-3.5 h-3.5 transition-transform ${
                  openMenu === "dates" ? "rotate-180" : ""
                }`}
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

            {openMenu === "dates" && (
              <div className="absolute z-30 mt-2 right-0 w-[300px] bg-white rounded-2xl border border-[#e7e4e1] shadow-xl p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#948d88] mb-2.5">
                  Quick ranges
                </p>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <button
                    onClick={() => applyPreset(0)}
                    className="px-3 py-2 rounded-full bg-stone-100 hover:bg-stone-200 text-xs font-semibold text-stone-700 transition-colors"
                  >
                    Today
                  </button>
                  <button
                    onClick={() => applyPreset(6)}
                    className="px-3 py-2 rounded-full bg-stone-100 hover:bg-stone-200 text-xs font-semibold text-stone-700 transition-colors"
                  >
                    Last 7 days
                  </button>
                  <button
                    onClick={() => applyPreset(29)}
                    className="px-3 py-2 rounded-full bg-stone-100 hover:bg-stone-200 text-xs font-semibold text-stone-700 transition-colors"
                  >
                    Last 30 days
                  </button>
                  <button
                    onClick={() => applyPreset(0, true)}
                    className="px-3 py-2 rounded-full bg-stone-100 hover:bg-stone-200 text-xs font-semibold text-stone-700 transition-colors"
                  >
                    This month
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2.5 mb-4">
                  <label className="block">
                    <span className="block text-[11px] font-semibold text-[#948d88] mb-1">From</span>
                    <input
                      type="date"
                      value={from}
                      max={to || undefined}
                      onChange={(e) => setFrom(e.target.value)}
                      className="w-full bg-stone-100 rounded-lg px-2.5 py-2 text-sm text-[#2a2426] outline-none focus:ring-2 focus:ring-[#a81724]/20"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-semibold text-[#948d88] mb-1">To</span>
                    <input
                      type="date"
                      value={to}
                      min={from || undefined}
                      onChange={(e) => setTo(e.target.value)}
                      className="w-full bg-stone-100 rounded-lg px-2.5 py-2 text-sm text-[#2a2426] outline-none focus:ring-2 focus:ring-[#a81724]/20"
                    />
                  </label>
                </div>
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => {
                      setFrom("");
                      setTo("");
                    }}
                    className="text-xs font-semibold text-stone-500 hover:text-[#2a2426] rounded-full px-3 py-2 transition-colors"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setOpenMenu(null)}
                    className="text-xs font-semibold bg-[#231b1d] hover:bg-black text-white rounded-full px-4 py-2 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Reset */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="h-11 inline-flex items-center gap-1.5 text-xs font-semibold text-[#a81724] hover:bg-[#a81724]/5 rounded-full px-4 transition-colors"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6L6 18 M6 6l12 12" />
              </svg>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#efece9]">
                <th className={thBase}>Applicant</th>
                <th className={thBase}>Contact</th>
                <th className={thBase}>Position</th>
                <th className={thBase}>Status</th>
                <th className={thBase}>Source</th>
                <th className={thBase}>Referral ID</th>
                <SortHeader label="Last Activity" sortKey="last_activity" />
                <th className={thBase}>Profile</th>
                <SortHeader label="Submitted" sortKey="created_at" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-[#948d88]">
                    Loading…
                  </td>
                </tr>
              ) : applications.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-[#948d88]">
                    No applications found.
                  </td>
                </tr>
              ) : (
                applications.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b border-[#f3f1ea] last:border-b-0 hover:bg-[#faf9f8] transition-colors"
                    style={{
                      boxShadow: `inset 3px 0 0 ${groupMeta(a.school_group).hex}`,
                    }}
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={a.full_name} group={a.school_group} />
                        <div className="min-w-0">
                          <p className="font-semibold text-[#2a2426] flex items-center gap-1.5">
                            {a.full_name}
                            {a.referred_branch && (
                              <span
                                className="inline-flex items-center bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0"
                                title={`Referred to ${a.referred_branch}`}
                              >
                                Referred
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] uppercase tracking-[0.1em] text-[#948d88] mt-0.5">
                            {[
                              a.experience_years ? `${a.experience_years} YRS EXP` : "",
                              a.current_company || a.qualification || "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="font-mono text-[13px] text-[#2a2426]">
                        {formatMobile(a.mobile)}
                      </p>
                      <p className="text-xs text-[#948d88] mt-0.5">{a.email}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="font-medium text-[#2a2426]">{a.position}</p>
                      <p className="text-xs text-[#948d88] mt-0.5 flex items-center gap-2">
                        {a.branch}
                        <GroupBadge group={a.school_group} />
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      {(() => {
                        const m = stageMeta(a.screening_status || "new");
                        return m ? (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"
                            style={{ color: m.hex, backgroundColor: `${m.hex}14` }}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: m.hex }}
                            />
                            {m.label}
                          </span>
                        ) : (
                          <span className="text-[#948d88] text-xs">—</span>
                        );
                      })()}
                      {a.referred_branch && (
                        <p
                          className="text-[10px] text-amber-700 mt-1 truncate max-w-[130px]"
                          title={`Referred to ${a.referred_branch}`}
                        >
                          → {a.referred_branch}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {(() => {
                        const src = a.source || "Website";
                        const paid = /ads$/i.test(src);
                        const direct = src === "Website";
                        return (
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${
                              paid
                                ? "bg-violet-50 text-violet-700"
                                : direct
                                  ? "bg-stone-100 text-stone-600"
                                  : "bg-sky-50 text-sky-700"
                            }`}
                            title={
                              a.utm_campaign
                                ? `Campaign: ${a.utm_campaign}`
                                : "No campaign tags on the visit"
                            }
                          >
                            {paid ? (
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 11l18-8-8 18-2-8-8-2z" />
                              </svg>
                            ) : direct ? (
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="9" />
                                <path d="M3 12h18 M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" />
                              </svg>
                            ) : (
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 12v8h16v-8 M12 3v13 M8 7l4-4 4 4" />
                              </svg>
                            )}
                            {src}
                          </span>
                        );
                      })()}
                      {a.utm_campaign && (
                        <p
                          className="text-[10px] text-[#948d88] mt-1 truncate max-w-[130px]"
                          title={a.utm_campaign}
                        >
                          {a.utm_campaign}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {a.referral_employee_code ? (
                        <span className="inline-flex items-center gap-1.5 border border-[#e7e4e1] rounded-full px-2.5 py-1 font-mono text-[11px] text-stone-600 bg-[#faf9f8]">
                          <svg
                            className="w-3 h-3 text-emerald-500"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle cx="12" cy="12" r="9" strokeWidth="1.8" />
                            <path d="M8.5 12.5l2.5 2.5 4.5-5" />
                          </svg>
                          {a.referral_employee_code}
                        </span>
                      ) : (
                        <span className="text-[#948d88] text-xs">—</span>
                      )}
                      {a.referral_employee_name && (
                        <p
                          className="text-[11px] text-[#948d88] mt-1 ml-1 truncate max-w-[130px]"
                          title={[
                            a.referral_employee_name,
                            a.referral_employee_branch,
                            a.referral_employee_contact,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        >
                          {a.referral_employee_name}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <p className="text-[13px] text-[#2a2426]">
                        {formatDate(a.last_activity_at || a.created_at)}
                      </p>
                      <p className="font-mono text-[11px] text-[#948d88] mt-0.5">
                        {formatTime(a.last_activity_at || a.created_at)}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <Link
                        to="/admin/applicant-profile"
                        onClick={() => setActiveApplicantId(a.id)}
                        state={{ application: a }}
                        className="inline-flex items-center gap-1.5 bg-[#a81724] hover:bg-[#33313d] text-white rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8" />
                        </svg>
                        View Profile
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <p className="text-[13px] text-[#2a2426]">{formatDate(a.created_at)}</p>
                      <p className="font-mono text-[11px] text-[#948d88] mt-0.5">
                        {formatTime(a.created_at)}
                      </p>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#efece9] bg-[#faf9f8]">
          <p className="text-xs text-[#948d88]">
            Showing {applications.length} application{applications.length === 1 ? "" : "s"}
          </p>
          <p className="font-mono text-[11px] text-[#948d88]">Updated just now</p>
        </div>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        onPage={setPage}
        totalItems={total}
        pageSize={20}
      />
    </div>
  );
};

export default ApplicationsPage;
