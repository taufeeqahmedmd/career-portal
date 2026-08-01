import React, { useEffect, useRef, useState } from "react";
import { getPublicConfig } from "../services/api";

// Cloudflare Turnstile widget. Renders nothing unless REACT_APP_TURNSTILE_SITE_KEY
// is set, so the forms behave exactly as before until the keys are configured.
// The token it produces is single-use and is verified server-side; the widget on
// its own proves nothing.

const SITE_KEY = process.env.REACT_APP_TURNSTILE_SITE_KEY || "";
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const captchaEnabled = () => !!SITE_KEY;

// One shared loader: several widgets on a page must not each inject the script
let scriptPromise = null;
const loadScript = () => {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load the security check."));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
};

// onChange receives the token, or "" when it expires or errors out.
// `resetKey` — change it to force a fresh token after a failed submit, since
// Cloudflare rejects a token that has already been redeemed.
// The backend can have a secret key while this bundle was built without the
// site key. Nothing would render, yet every submission would be rejected for a
// missing captcha - so ask the server and say so plainly instead.
export const useCaptchaMismatch = () => {
  const [mismatch, setMismatch] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getPublicConfig()
      .then((res) => {
        if (!cancelled && res.data.captcha_enabled && !SITE_KEY) setMismatch(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return mismatch;
};

const Turnstile = ({ onChange, resetKey = 0, theme = "auto", className = "" }) => {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  // Kept in a ref so re-rendering with a new callback never re-mounts the widget
  const onChangeRef = useRef(onChange);
  const [failed, setFailed] = useState("");
  const mismatch = useCaptchaMismatch();

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!SITE_KEY) return undefined;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          theme,
          callback: (token) => onChangeRef.current?.(token),
          "expired-callback": () => onChangeRef.current?.(""),
          "error-callback": () => onChangeRef.current?.(""),
        });
      })
      .catch((err) => {
        if (!cancelled) setFailed(err.message);
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // The widget is already gone - nothing to clean up
        }
        widgetIdRef.current = null;
      }
    };
    // theme is read once at render time; changing it would need a remount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A redeemed token cannot be replayed, so a failed submit needs a new one
  useEffect(() => {
    if (!resetKey || !widgetIdRef.current || !window.turnstile) return;
    try {
      window.turnstile.reset(widgetIdRef.current);
      onChangeRef.current?.("");
    } catch {
      // Nothing to reset yet
    }
  }, [resetKey]);

  if (!SITE_KEY) {
    // Silent when the captcha is off everywhere; loud when only this bundle
    // is missing its key, because then nothing can be submitted at all
    return mismatch ? (
      <div className={className}>
        <p className="text-xs rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[#b91c1c]">
          The security check is enabled on the server but this build has no site key, so
          submissions will be rejected. Set REACT_APP_TURNSTILE_SITE_KEY and rebuild.
        </p>
      </div>
    ) : null;
  }

  return (
    <div className={className}>
      <div ref={containerRef} />
      {failed && <p className="text-xs text-[#b91c1c] mt-1">{failed}</p>}
    </div>
  );
};

export default Turnstile;
