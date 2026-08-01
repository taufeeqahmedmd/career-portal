import React, { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { forgotPassword, resetPassword } from "../../services/api";
import Turnstile, { captchaEnabled } from "../../components/Turnstile";
import { btnDark } from "../ui";
import emblem from "../../assets/admin-emblem.png";
import mobileLogo from "../../assets/admin-mob-logo.png";
import loginArt from "../../assets/admin-login-art.jpg";

// Below lg the form sits on a frosted card over the photograph, so everything
// here carries two skins: light-on-glass by default, and the panel's normal
// dark-on-white from lg upwards.
const fieldCls =
  "glass-field w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition " +
  "bg-white/10 border-white/25 text-white placeholder-white/45 focus:border-white/70 focus:ring-2 focus:ring-white/25 " +
  "lg:bg-white lg:border-[#d8d3cf] lg:text-[#2a2426] lg:placeholder-[#a8a29e] lg:focus:border-[#a81724] lg:focus:ring-[#a81724]/20";

const labelCls =
  "block text-[11px] font-semibold uppercase tracking-wider text-white/65 lg:text-[#7d7679] mb-1.5";

const linkCls =
  "text-xs font-semibold text-white/85 hover:text-white lg:text-[#a81724] lg:hover:text-[#a81724] hover:underline disabled:opacity-50";

const hintCls =
  "flex items-center gap-1.5 text-[11px] text-amber-200 lg:text-[#8a6d3b] mt-1.5";

// One 6-digit input shared by the two-factor and password-reset steps.
// onComplete fires with the finished value so a step that needs nothing else
// can submit itself instead of asking for one more click.
const CodeInput = ({ value, onChange, onComplete, autoFocus, label = "6-digit code" }) => (
  <div>
    <label className={labelCls}>{label}</label>
    <input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => {
        const next = e.target.value.replace(/\D/g, "").slice(0, 6);
        onChange(next);
        if (next.length === 6) onComplete?.(next);
      }}
      placeholder="000000"
      className={`${fieldCls} text-center font-mono text-2xl tracking-[0.4em]`}
    />
  </div>
);

// Password field with a reveal toggle. The eye is a button so it never
// submits the form, and it stays out of the tab order between the field and
// the submit button. Caps Lock is the usual reason a known-good password
// stops working, so it is called out inline.
const PasswordInput = ({ value, onChange, ...props }) => {
  const [shown, setShown] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  const readCaps = (e) => {
    if (typeof e.getModifierState === "function") setCapsOn(e.getModifierState("CapsLock"));
  };

  return (
    <div>
      <div className="relative">
        <input
          {...props}
          type={shown ? "text" : "password"}
          value={value}
          onChange={onChange}
          onKeyUp={readCaps}
          onKeyDown={readCaps}
          onBlur={() => setCapsOn(false)}
          className={`${fieldCls} pr-11`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          title={shown ? "Hide password" : "Show password"}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-md text-white/60 hover:text-white lg:text-[#948d88] lg:hover:text-[#2a2426] transition-colors"
        >
          <svg
            className="w-[18px] h-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {shown ? (
              <>
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <path d="M1 1l22 22" />
              </>
            ) : (
              <>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </>
            )}
          </svg>
        </button>
      </div>
      {capsOn && (
        <p className={hintCls}>
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
          Caps Lock is on
        </p>
      )}
    </div>
  );
};

const Notice = ({ tone = "error", children }) =>
  children ? (
    <p
      role={tone === "error" ? "alert" : "status"}
      aria-live="polite"
      className={`text-sm rounded-md px-3 py-2 border ${
        tone === "error"
          ? "text-[#b91c1c] bg-[#fef2f2] border-[#fecaca]"
          : "text-[#166534] bg-[#f0fdf4] border-[#bbf7d0]"
      }`}
    >
      {children}
    </p>
  ) : null;

// The widget loads asynchronously; holding its height keeps the submit button
// from jumping out from under the cursor
const CaptchaSlot = ({ onChange, resetKey }) =>
  captchaEnabled() ? (
    <div className="min-h-[70px]">
      <Turnstile onChange={onChange} resetKey={resetKey} />
    </div>
  ) : null;

const AdminLogin = () => {
  const { user, loading, login, verifyTotp } = useAuth();
  const navigate = useNavigate();

  // credentials | totp | totp_setup | forgot | reset
  const [step, setStep] = useState("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [challenge, setChallenge] = useState(null); // { challenge_token, qr_data_url, secret }
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // A Turnstile token is single-use, so a rejected submit needs a fresh one
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const resetCaptcha = () => setCaptchaNonce((n) => n + 1);

  // An existing session is still being restored - showing the form here would
  // flash it at someone who is about to be redirected to the dashboard
  if (loading) {
    return (
      <div className="min-h-screen bg-[#f4f3f1] flex items-center justify-center">
        <span className="w-8 h-8 rounded-full border-2 border-[#d8d3cf] border-t-[#a81724] animate-spin" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/admin" replace />;
  }

  const go = (next) => {
    setStep(next);
    setError("");
    setInfo("");
  };

  // Returns false and explains itself, rather than leaving a dead button, when
  // the widget has not produced a token (blocked script, expired challenge)
  const captchaReady = () => {
    if (captchaEnabled() && !captchaToken) {
      setError("Please complete the security check below, then try again.");
      return false;
    }
    return true;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!captchaReady()) return;
    setSubmitting(true);
    try {
      const result = await login(email.trim(), password, captchaToken);
      if (result.challenge) {
        setChallenge(result);
        setCode("");
        setStep(result.challenge === "totp_setup" ? "totp_setup" : "totp");
        setSubmitting(false);
        return;
      }
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || "Login failed. Please try again.");
      resetCaptcha();
      setSubmitting(false);
    }
  };

  // Called both by the form and by CodeInput once six digits are in, which is
  // why the code can arrive as an argument instead of from state
  const handleTotp = async (e, typedCode) => {
    if (e) e.preventDefault();
    const value = typedCode || code;
    if (submitting || value.length !== 6) return;
    setError("");
    setSubmitting(true);
    try {
      await verifyTotp(challenge.challenge_token, value);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || "Verification failed. Please try again.");
      setCode("");
      setSubmitting(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setError("");
    if (!captchaReady()) return;
    setSubmitting(true);
    try {
      const res = await forgotPassword(email.trim(), captchaToken);
      setInfo(res.data.message);
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
      setStep("reset");
    } catch (err) {
      setError(err.response?.data?.error || "Could not send the reset code.");
      resetCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("The two passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(email.trim(), code, newPassword);
      setPassword("");
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
      setStep("credentials");
      setInfo("Your password has been reset. Sign in with your new password.");
      resetCaptcha();
    } catch (err) {
      setError(err.response?.data?.error || "Could not reset your password.");
    } finally {
      setSubmitting(false);
    }
  };

  const passwordsMismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;

  const heading = {
    credentials: { title: "Sign in", sub: "Enter your credentials to access the dashboard." },
    totp: {
      title: "Two-factor authentication",
      sub: "Enter the 6-digit code from your authenticator app.",
    },
    totp_setup: {
      title: "Set up two-factor authentication",
      sub: "Scan the QR code with your authenticator app, then enter the code it shows.",
    },
    forgot: {
      title: "Forgot password",
      sub: "Enter your email and we will send you a one-time code.",
    },
    reset: {
      title: "Set a new password",
      sub: "Enter the code from your email and choose a new password.",
    },
  }[step];

  return (
    <div className="relative min-h-screen bg-white lg:grid lg:grid-cols-2">
      {/* Below lg the photograph becomes the page, with the form floating on
          it as a frosted card */}
      <div className="absolute inset-0 lg:hidden">
        <img
          src={loginArt}
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-[#7d1019]/25 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#2a0508]/75 via-[#2a0508]/55 to-[#2a0508]/90" />
      </div>

      {/* Brand panel - desktop only; the form is the whole page on mobile */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12">
        <img
          src={loginArt}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* A light wash carries the brand; the scrim is heaviest at the edges
            where the text sits, so the subject stays clearly visible */}
        <div className="absolute inset-0 bg-[#7d1019]/30 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#2a0508]/95 via-[#2a0508]/20 to-[#2a0508]/65" />

        <p className="relative font-mono text-[11px] uppercase tracking-[0.2em] text-white/70">
          Careers Portal
        </p>

        <div className="relative">
          <h2 className="font-poppins text-3xl xl:text-4xl font-semibold text-white leading-tight">
            Every application,
            <br />
            one place.
          </h2>
          <p className="text-sm text-white/75 mt-4 max-w-sm leading-relaxed">
            Track applicants from first submission through screening, interview
            rounds and offer — across every branch.
          </p>
          <div className="h-px w-16 bg-white/30 mt-8" />
        </div>
      </div>

      {/* Form column */}
      {/* Bottom-anchored on mobile so the card never sits over the subject's
          face; centred again once the photo moves to its own panel */}
      <div className="relative flex min-h-screen items-end justify-center px-4 pt-24 pb-10 sm:px-8 lg:min-h-0 lg:items-center lg:pt-12 lg:pb-12">
        <div
          className="w-full max-w-sm rounded-3xl border border-white/20 bg-white/10 p-6 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.75)] ring-1 ring-inset ring-white/10 backdrop-blur-xl sm:p-8
                     lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:ring-0 lg:backdrop-blur-none"
        >
          <div className="flex items-center gap-3 mb-8 lg:gap-2.5">
            {/* On glass the stacked mark carries its own white wordmark, so the
                typed one would only repeat it - and the space goes to the
                titles instead */}
            <img src={mobileLogo} alt="Innovative" className="h-14 w-auto lg:hidden" />
            <img
              src={emblem}
              alt=""
              aria-hidden="true"
              className="hidden lg:block h-9 w-auto"
            />
            <span className="hidden lg:inline text-[#c4beb9]" aria-hidden="true">
              &ndash;
            </span>
            <span className="hidden lg:inline font-poppins text-base font-semibold text-[#2a2426]">
              Innovative
            </span>
            <div className="pl-3 lg:pl-2.5 lg:ml-0.5 border-l border-white/25 lg:border-[#d8d3cf]">
              <h1 className="font-poppins text-base font-semibold text-white lg:text-[#2a2426] leading-tight">
                Careers Admin
              </h1>
              <p className="text-[11px] text-white/60 lg:text-[#948d88] leading-snug">
                Delhi Public Schools &amp;
                <br />
                Pallavi Group of Schools
              </p>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="font-poppins text-2xl font-semibold text-white lg:text-[#2a2426]">
              {heading.title}
            </h2>
            <p className="text-sm text-white/70 lg:text-[#7d7679] mt-1">{heading.sub}</p>
          </div>

          {/* Step 1 - email and password */}
          {step === "credentials" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className={labelCls}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  autoComplete="username"
                  className={fieldCls}
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={`${labelCls} !mb-0`}>Password</label>
                  <button type="button" onClick={() => go("forgot")} className={linkCls}>
                    Forgot password?
                  </button>
                </div>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
              </div>

              <CaptchaSlot onChange={setCaptchaToken} resetKey={captchaNonce} />
              <Notice tone="success">{info}</Notice>
              <Notice>{error}</Notice>

              <button
                type="submit"
                disabled={submitting}
                className={`${btnDark} w-full justify-center`}
              >
                {submitting ? "Signing in…" : "Sign In"}
              </button>
            </form>
          )}

          {/* Step 2 - two-factor, either enrolment or a routine challenge */}
          {(step === "totp" || step === "totp_setup") && (
            <form onSubmit={handleTotp} className="space-y-4">
              {step === "totp_setup" && (
                <div className="rounded-xl border border-white/20 bg-white/85 lg:border-[#e7e4e1] lg:bg-[#faf9f8] p-4 text-center">
                  {challenge?.qr_data_url ? (
                    <img
                      src={challenge.qr_data_url}
                      alt="Two-factor setup QR code"
                      className="mx-auto rounded-lg bg-white p-1"
                      width={196}
                      height={196}
                    />
                  ) : null}
                  <p className="text-[11px] text-[#948d88] mt-3 mb-1">
                    Can&apos;t scan? Enter this key in your app instead:
                  </p>
                  <p className="font-mono text-xs font-semibold text-[#2a2426] break-all select-all">
                    {challenge?.secret}
                  </p>
                </div>
              )}

              <CodeInput
                value={code}
                onChange={setCode}
                onComplete={(typed) => handleTotp(null, typed)}
                autoFocus
              />
              <Notice>{error}</Notice>

              <button
                type="submit"
                disabled={submitting || code.length !== 6}
                className={`${btnDark} w-full justify-center`}
              >
                {submitting ? "Verifying…" : step === "totp_setup" ? "Confirm & Sign In" : "Verify"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setChallenge(null);
                  setPassword("");
                  resetCaptcha();
                  go("credentials");
                }}
                className={`${linkCls} block mx-auto`}
              >
                Back to sign in
              </button>
            </form>
          )}

          {/* Forgot password - request a code */}
          {step === "forgot" && (
            <form onSubmit={handleForgot} className="space-y-4">
              <div>
                <label className={labelCls}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  autoComplete="username"
                  className={fieldCls}
                  placeholder="you@example.com"
                />
              </div>

              <CaptchaSlot onChange={setCaptchaToken} resetKey={captchaNonce} />
              <Notice>{error}</Notice>

              <button
                type="submit"
                disabled={submitting}
                className={`${btnDark} w-full justify-center`}
              >
                {submitting ? "Sending…" : "Send Code"}
              </button>
              <button
                type="button"
                onClick={() => go("credentials")}
                className={`${linkCls} block mx-auto`}
              >
                Back to sign in
              </button>
            </form>
          )}

          {/* Forgot password - redeem the code */}
          {step === "reset" && (
            <form onSubmit={handleReset} className="space-y-4">
              <Notice tone="success">{info}</Notice>
              <CodeInput value={code} onChange={setCode} autoFocus label="Code from email" />
              <div>
                <label className={labelCls}>New password</label>
                <PasswordInput
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label className={labelCls}>Confirm new password</label>
                <PasswordInput
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Repeat the password"
                />
                {passwordsMismatch && (
                  <p className="text-[11px] text-red-200 lg:text-[#b91c1c] mt-1.5">
                    The two passwords do not match.
                  </p>
                )}
              </div>

              <Notice>{error}</Notice>

              <button
                type="submit"
                disabled={
                  submitting ||
                  code.length !== 6 ||
                  newPassword.length < 8 ||
                  passwordsMismatch
                }
                className={`${btnDark} w-full justify-center`}
              >
                {submitting ? "Saving…" : "Reset Password"}
              </button>
              <button
                type="button"
                onClick={() => go("forgot")}
                className={`${linkCls} block mx-auto`}
              >
                Send a new code
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
