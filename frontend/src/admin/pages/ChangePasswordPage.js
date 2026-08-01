import React, { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { btnDark, inputBase } from "../ui";
import emblem from "../../assets/admin-emblem.png";

const labelCls =
  "block text-[11px] font-semibold uppercase tracking-wider text-[#7d7679] mb-1.5";

// Shown on its own, outside the admin shell: an account still on the initial
// password has no access to the portal until this is done.
const ChangePasswordPage = () => {
  const { user, loading, changePassword, logout, mustChangePassword } = useAuth();
  const navigate = useNavigate();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!loading && !user) return <Navigate to="/admin/login" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (next !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    if (next === current) {
      setError("Choose a password different from your current one.");
      return;
    }
    setSaving(true);
    try {
      await changePassword(current, next);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || "Could not change your password.");
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f3f1] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <img src={emblem} alt="" aria-hidden="true" className="h-9 w-auto" />
          <span className="text-[#c4beb9]" aria-hidden="true">
            &ndash;
          </span>
          <span className="font-poppins text-base font-semibold text-[#2a2426]">
            Innovative
          </span>
          <div className="pl-3 border-l border-[#d8d3cf]">
            <h1 className="font-poppins text-lg font-semibold text-[#2a2426] leading-tight">
              Careers Admin
            </h1>
            <p className="text-[11px] text-[#948d88]">
              Delhi Public Schools &amp; Pallavi Group of Schools
            </p>
          </div>
        </div>

        <div className="bg-white border border-[#e7e4e1] border-t-4 border-t-[#a81724] rounded-2xl p-6 sm:p-8">
          <div className="mb-6">
            <h2 className="font-poppins text-xl font-semibold text-[#2a2426]">
              {mustChangePassword ? "Choose your password" : "Change password"}
            </h2>
            <p className="text-sm text-[#7d7679] mt-1">
              {mustChangePassword
                ? "Your account is still on the password you were given. Set your own to continue."
                : "Pick a new password for your account."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelCls}>
                {mustChangePassword ? "Current (temporary) password" : "Current password"}
              </label>
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
                autoFocus
                autoComplete="current-password"
                className={`${inputBase} w-full`}
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className={labelCls}>New password</label>
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className={`${inputBase} w-full`}
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label className={labelCls}>Confirm new password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className={`${inputBase} w-full`}
                placeholder="Repeat the password"
              />
            </div>

            {error && (
              <p className="text-sm text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={saving || next.length < 8}
              className={`${btnDark} w-full justify-center disabled:opacity-60`}
            >
              {saving ? "Saving…" : "Save Password"}
            </button>
          </form>

          <button
            type="button"
            onClick={logout}
            className="block mx-auto mt-4 text-xs font-semibold text-[#948d88] hover:text-[#a81724]"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChangePasswordPage;
