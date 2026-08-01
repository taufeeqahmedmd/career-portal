import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import Toaster from "../components/Toaster";
import { useAuth } from "./AuthContext";
import { getApplicationStats, getEntities } from "../services/api";
import { registerEntities, groupMeta, groupLogo } from "./ui";
import emblem from "../assets/admin-emblem.png";

const COLLAPSE_KEY = "admin_sidebar_collapsed";

const Icon = ({ d, className = "w-[18px] h-[18px]" }) => (
  <svg
    className={`${className} shrink-0`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

const ICONS = {
  menu: "M3 6h18 M3 12h18 M3 18h18",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  dashboard: "M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z",
  applications:
    "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2 M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 M9 12h6 M9 16h6",
  openings:
    "M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M3 13h18",
  branches:
    "M3 21h18 M5 21V7l7-4v18 M19 21V11l-7-4 M9 9v.01 M9 12v.01 M9 15v.01 M9 18v.01",
  entities:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
  users:
    "M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  roles:
    "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9.5 11.5l2 2 3.5-3.5",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  chevron: "M6 9l6 6 6-6",
  flow: "M4 4h6v6H4z M14 14h6v6h-6z M17 4v6 M14 7h6 M7 14v3a2 2 0 0 0 2 2h5 M10 7h2a2 2 0 0 1 2 2v2",
};

const Brand = () => (
  <div className="flex items-center gap-2">
    <img src={emblem} alt="" aria-hidden="true" className="h-8 w-auto" />
    <span className="text-[#c4beb9]" aria-hidden="true">
      &ndash;
    </span>
    <span className="font-poppins text-base font-semibold text-[#2a2426] leading-none">
      Innovative
    </span>
  </div>
);

const AdminLayout = () => {
  const { user, logout, can } = useAuth();
  const location = useLocation();
  const [stats, setStats] = useState(null);
  // Configuration group starts open when a config page is the current route
  const [configOpen, setConfigOpen] = useState(() =>
    /^\/admin\/(entities|branches|roles|flow)/.test(window.location.pathname)
  );

  useEffect(() => {
    if (/^\/admin\/(entities|branches|roles|flow)/.test(location.pathname)) {
      setConfigOpen(true);
    }
  }, [location.pathname]);
  // Desktop only: full sidebar <-> icon rail (persisted). Mobile uses the bottom dock.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1"
  );

  useEffect(() => {
    if (!can("applications.view")) return;
    getApplicationStats()
      .then((res) => setStats(res.data))
      .catch(() => {});
  }, [can]);

  const toggleSidebar = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  };

  // Load entity registry (labels + colors) for badges across the panel
  const [entityList, setEntityList] = useState([]);
  useEffect(() => {
    getEntities()
      .then((res) => {
        registerEntities(res.data.entities);
        setEntityList(res.data.entities);
      })
      .catch(() => {});
  }, []);

  const scopeText = user?.branch_name
    ? user.branch_name
    : user?.school_group
      ? groupMeta(user.school_group).label
      : "All Schools";

  const initials = String(user?.name || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const groups = entityList
    .filter((e) => e.is_active)
    .map((e) => ({ key: e.code, label: e.name, hex: e.color, logo: groupLogo(e.code) }))
    .filter((g) => !user?.school_group || user.school_group === g.key);

  const primaryItems = [
    { to: "/admin", label: "Dashboard", short: "Home", icon: ICONS.dashboard, show: can("applications.view"), end: true },
    { to: "/admin/applications", label: "Applications", short: "Intake", icon: ICONS.applications, show: can("applications.view"), badge: stats?.total },
    { to: "/admin/openings", label: "Job Openings", short: "Openings", icon: ICONS.openings, show: can("openings.view") },
    { to: "/admin/users", label: "Users", short: "Users", icon: ICONS.users, show: can("users.manage") },
  ].filter((i) => i.show);

  const configItems = [
    { to: "/admin/entities", label: "Entities", short: "Entities", icon: ICONS.entities, show: can("entities.manage") },
    { to: "/admin/branches", label: "Branches", short: "Branches", icon: ICONS.branches, show: can("branches.manage") },
    { to: "/admin/roles", label: "Roles", short: "Roles", icon: ICONS.roles, show: can("roles.manage") },
    { to: "/admin/flow", label: "Flow Configuration", short: "Flow", icon: ICONS.flow, show: can("flow.manage") },
  ].filter((i) => i.show);

  // The mobile dock stays flat - a dropdown does not work down there
  const navItems = [...primaryItems, ...configItems];

  const navLinkClass = ({ isActive }) =>
    `group relative flex items-center gap-3 rounded-full text-sm font-medium transition-colors py-2.5 ${
      collapsed ? "lg:justify-center lg:px-0" : ""
    } px-4 ${
      isActive
        ? "bg-[#231b1d] text-white"
        : "text-stone-500 hover:bg-stone-100 hover:text-[#2a2426]"
    }`;

  const renderDesktopLink = (item) => (
    <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass} title={item.label}>
      {({ isActive }) => (
        <>
          <Icon d={item.icon} />
          <span className={`flex-1 truncate ${collapsed ? "hidden" : ""}`}>{item.label}</span>
          {item.badge != null && (
            <span
              className={`text-[10px] font-semibold rounded-full min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center ${
                collapsed ? "hidden" : ""
              } ${isActive ? "bg-white/20 text-white" : "bg-stone-100 text-stone-600"}`}
            >
              {item.badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );

  return (
    <div className="min-h-screen bg-[#e8e4e0]">
      {/* Floating top app bar */}
      <header className="fixed top-3 left-3 right-3 h-14 z-40 bg-white rounded-2xl flex items-center gap-2 px-3 sm:px-5 shadow-sm">
        <Brand />
        {/* Desktop: collapse the sidebar to an icon rail */}
        <button
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          className="hidden lg:flex w-9 h-9 rounded-full items-center justify-center text-[#2a2426] hover:bg-stone-100 transition-colors"
        >
          <Icon d={ICONS.menu} />
        </button>

        {/* User chip (desktop) */}
        <div className="ml-auto hidden lg:flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-semibold text-[#2a2426] leading-tight">{user?.name}</p>
            <p className="text-[11px] text-[#948d88] leading-tight">
              {user?.role_name || "Admin"}
              {user?.permissions?.includes("*") ? "" : ` · ${scopeText}`}
            </p>
          </div>
          <span className="w-9 h-9 rounded-full bg-[#a81724] text-white text-xs font-bold flex items-center justify-center">
            {initials}
          </span>
        </div>

        {/* Mobile: user + logout live up here since the dock has no room for them */}
        <div className="ml-auto lg:hidden flex items-center gap-2">
          <span className="w-8 h-8 rounded-full bg-[#a81724] text-white text-[10px] font-bold flex items-center justify-center">
            {initials}
          </span>
          <button
            onClick={logout}
            title="Logout"
            aria-label="Logout"
            className="w-9 h-9 rounded-full flex items-center justify-center text-[#948d88] hover:text-[#dc2626] hover:bg-stone-100 transition-colors"
          >
            <Icon d={ICONS.logout} />
          </button>
        </div>
      </header>

      {/* Floating sidebar card (desktop only) */}
      <aside
        className={`hidden lg:flex fixed z-30 top-[76px] bottom-3 left-3 flex-col bg-white rounded-2xl shadow-sm
          transition-[width] duration-200 ${collapsed ? "w-[72px]" : "w-64"}`}
      >
        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
          {primaryItems.map(renderDesktopLink)}

          {configItems.length > 0 &&
            (collapsed ? (
              <>
                <div className="h-px bg-[#efece9] my-1 mx-2" />
                {configItems.map(renderDesktopLink)}
              </>
            ) : (
              <div className="mt-1">
                <button
                  onClick={() => setConfigOpen((o) => !o)}
                  className="w-full flex items-center gap-3 rounded-full text-sm font-medium py-2.5 px-4 text-stone-500 hover:bg-stone-100 hover:text-[#2a2426] transition-colors"
                >
                  <Icon d={ICONS.settings} />
                  <span className="flex-1 text-left truncate">Configuration</span>
                  <Icon
                    d={ICONS.chevron}
                    className={`w-3.5 h-3.5 transition-transform ${configOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {configOpen && (
                  <div className="mt-1 flex flex-col gap-1 ml-5 pl-3 border-l border-[#efece9]">
                    {configItems.map(renderDesktopLink)}
                  </div>
                )}
              </div>
            ))}
        </nav>

        {/* Groups summary (like the reference's Residents list) */}
        {stats && !collapsed && groups.length > 0 && (
          <div className="px-4 py-4 border-t border-[#efece9]">
            <p className="font-poppins text-sm font-semibold text-[#2a2426] mb-3">Groups</p>
            <ul className="space-y-2.5">
              {groups.map((g) => (
                <li key={g.key} className="flex items-center gap-2.5 text-xs">
                  {g.logo ? (
                    <img
                      src={g.logo}
                      alt={g.label}
                      className="w-8 h-8 rounded-full object-contain bg-white shrink-0"
                    />
                  ) : (
                    <span
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                      style={{ color: g.hex, backgroundColor: `${g.hex}14` }}
                    >
                      {g.key.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="flex-1 text-stone-600 font-medium truncate">{g.label}</span>
                  <span className="font-mono text-[11px] text-[#2a2426] bg-stone-100 rounded-full px-2 py-0.5">
                    {stats.byGroup?.[g.key] ?? 0}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Logout pill (like the reference's Broadcast button) */}
        <div className="p-3 border-t border-[#efece9]">
          <button
            onClick={logout}
            title="Logout"
            className={`w-full flex items-center justify-center gap-2 bg-[#231b1d] hover:bg-black text-white text-sm font-semibold rounded-full transition-colors ${
              collapsed ? "h-11" : "py-2.5 px-4"
            }`}
          >
            <Icon d={ICONS.logout} className="w-4 h-4" />
            <span className={collapsed ? "hidden" : ""}>Logout</span>
          </button>
        </div>
      </aside>

      {/* Bottom dock (mobile & tablet) */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[#e7e4e1] rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch justify-around px-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 py-1.5 text-[10px] font-semibold transition-colors ${
                  isActive ? "text-[#a81724]" : "text-[#948d88]"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`relative w-12 h-7 rounded-full flex items-center justify-center transition-colors ${
                      isActive ? "bg-[#231b1d] text-white" : ""
                    }`}
                  >
                    <Icon d={item.icon} className="w-[19px] h-[19px]" />
                    {item.badge != null && item.badge > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#dc2626] text-white text-[9px] font-bold flex items-center justify-center">
                        {item.badge}
                      </span>
                    )}
                  </span>
                  <span className="truncate max-w-full px-0.5">{item.short}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main
        className={`pt-[80px] min-h-screen pb-24 lg:pb-3 transition-[padding-left] duration-200 ${
          collapsed ? "lg:pl-[96px]" : "lg:pl-[280px]"
        }`}
      >
        <div className="px-3 sm:px-5 lg:pl-2 lg:pr-5 py-3 sm:py-4">
          <Outlet />
        </div>
      </main>

      <Toaster />
    </div>
  );
};

export default AdminLayout;
