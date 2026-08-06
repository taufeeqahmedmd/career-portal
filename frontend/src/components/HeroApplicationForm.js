import React, { useState, useEffect, useRef } from "react";
import { notify } from "./Toaster";
import { submitApplication, getFormToken } from "../services/api";
import { getAttribution } from "../attribution";
import Turnstile, { captchaEnabled } from "./Turnstile";

// A field no applicant ever sees. Anything in it came from something filling in
// every input on the page, so the server rejects the submission.
const HONEYPOT_FIELD = "company_website";

// PDF only: it renders natively in every browser and keeps the candidate's
// layout exactly as written, so reviewers never leave the portal to read a CV.
const RESUME_TYPES = ["application/pdf"];
const MAX_RESUME_MB = 5;

const inputBase =
  "w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-stone-900 placeholder-stone-400 outline-none transition focus:ring-2 focus:ring-[#a81724]/15";
const inputClass = (hasError) =>
  `${inputBase} ${hasError ? "border-[#b91c1c]" : "border-stone-200 focus:border-[#a81724]"}`;
const labelClass = "mb-1.5 text-[13px] font-medium text-stone-600";
const errorClass = "mt-1 text-xs text-[#b91c1c]";

const STEP_1_FIELDS = [
  "full_name",
  "email",
  "mobile",
  "opening_id",
  "experience_years",
  "current_company",
  "resume",
];
const STEP_2_FIELDS = ["referral_employee_name", "referral_employee_contact"];

// Every rule here mirrors one the server enforces, so a submission that passes
// the form is not rejected on the far side
const validators = {
  full_name: (v) => {
    const value = v.trim();
    if (!value) return "Full name is required.";
    if (value.length < 3) return "Name must be at least 3 characters.";
    if (value.length > 120) return "Name must be 120 characters or less.";
    // Letters in any script, plus combining marks: an ASCII-only rule turned
    // names like "José Álvarez" or "Zoë" away at a form the server accepts
    if (!/^\p{L}[\p{L}\p{M}\s.'-]*$/u.test(value))
      return "Name can only contain letters, spaces and . ' -";
    return "";
  },
  email: (v) => {
    const value = v.trim();
    if (!value) return "Email ID is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Enter a valid email ID.";
    if (value.length > 160) return "Email ID is too long.";
    return "";
  },
  mobile: (v) => {
    if (!v) return "Mobile number is required.";
    if (!/^\d{10}$/.test(v)) return "Mobile must be exactly 10 digits.";
    if (!/^[6-9]/.test(v)) return "Enter a valid Indian mobile number.";
    return "";
  },
  opening_id: (v) => (v ? "" : "Please select a position."),
  experience_years: (v) => {
    const value = v.trim();
    if (!value) return "Years of experience is required.";
    const years = Number(value);
    if (!Number.isFinite(years)) return "Enter experience as a number.";
    if (years < 0) return "Experience cannot be negative.";
    if (years > 60) return "Experience must be 60 years or less.";
    return "";
  },
  current_company: (v) => {
    const value = v.trim();
    if (!value) return 'Enter your organisation, or "Fresher".';
    if (value.length > 120) return "This must be 120 characters or less.";
    return "";
  },
  referral_employee_name: (v) => {
    const value = v.trim();
    if (!value) return "Referring employee's name is required.";
    if (value.length < 3) return "Name must be at least 3 characters.";
    if (value.length > 120) return "Name must be 120 characters or less.";
    // Letters in any script, plus combining marks: an ASCII-only rule turned
    // names like "José Álvarez" or "Zoë" away at a form the server accepts
    if (!/^\p{L}[\p{L}\p{M}\s.'-]*$/u.test(value))
      return "Name can only contain letters, spaces and . ' -";
    return "";
  },
  referral_employee_contact: (v) => {
    if (!v) return "Referring employee's mobile is required.";
    if (!/^\d{10}$/.test(v)) return "Mobile must be exactly 10 digits.";
    if (!/^[6-9]/.test(v)) return "Enter a valid Indian mobile number.";
    return "";
  },
  referral_employee_code: (v) =>
    v.trim().length > 40 ? "Employee ID is too long." : "",
  referral_employee_branch: (v) =>
    v.trim().length > 120 ? "Department is too long." : "",
};

const validateResume = (file) => {
  if (!file) return "Please upload your resume.";
  if (!RESUME_TYPES.includes(file.type)) return "Resume must be a PDF. Save your Word document as PDF and upload that.";
  if (!file.size) return "The selected file is empty.";
  if (file.size >= MAX_RESUME_MB * 1024 * 1024)
    return `Resume must be ${MAX_RESUME_MB} MB or smaller.`;
  return "";
};

const HeroApplicationForm = ({ selectedOpening, openings, onSuccess }) => {
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [resume, setResume] = useState(null);
  const fileInputRef = useRef(null);
  const formRef = useRef(null);

  const [hasReferral, setHasReferral] = useState(false);
  // Turnstile tokens are single-use; bumping the nonce re-issues one after a
  // rejected submit
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaNonce, setCaptchaNonce] = useState(0);
  // Anti-spam: a token issued when the form opens, and a field only a bot fills
  const [formToken, setFormToken] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [formValues, setFormValues] = useState({
    full_name: "",
    email: "",
    mobile: "",
    opening_id: selectedOpening?.id ? String(selectedOpening.id) : "",
    experience_years: "",
    current_company: "",
    referral_employee_name: "",
    referral_employee_code: "",
    referral_employee_branch: "",
    referral_employee_contact: "",
  });

  // Fetched once, when the form opens: the age of this token is what tells the
  // server a human filled the form in rather than a script posting instantly
  useEffect(() => {
    let cancelled = false;
    getFormToken()
      .then((res) => {
        if (!cancelled) setFormToken(res.data.token);
      })
      .catch(() => {
        // Not fatal here - the server decides whether a submission without one
        // is acceptable, and says so in its response
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // "Apply Now" on a job card pre-selects that position
  useEffect(() => {
    if (selectedOpening) {
      setFormValues((prev) => ({ ...prev, opening_id: String(selectedOpening.id) }));
      setErrors((prev) => ({ ...prev, opening_id: "" }));
    }
  }, [selectedOpening]);

  const setError = (field, message) =>
    setErrors((prev) => ({ ...prev, [field]: message }));

  const onlyDigits = (v) => v.replace(/\D/g, "").slice(0, 10);

  const errorFor = (field, values = formValues, file = resume) =>
    field === "resume" ? validateResume(file) : validators[field](values[field]);

  const stepFields = step === 1 ? STEP_1_FIELDS : STEP_2_FIELDS;
  const isLastStep = !hasReferral || step === 2;

  // Errors already on screen keep updating as the user types; untouched fields
  // stay quiet until Continue / Submit reveals what is missing
  const handleChange = (e) => {
    const { name, value } = e.target;
    const next = { ...formValues, [name]: value };
    setFormValues(next);
    if (errors[name]) setError(name, errorFor(name, next));
  };

  const handleDigitsChange = (e) => {
    const { name } = e.target;
    const next = { ...formValues, [name]: onlyDigits(e.target.value) };
    setFormValues(next);
    if (errors[name]) setError(name, errorFor(name, next));
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    if (validators[name]) setError(name, errorFor(name));
  };

  const handleResumeChange = (e) => {
    const file = e.target.files?.[0] || null;
    const message = validateResume(file);
    setResume(message ? null : file);
    setError("resume", file ? message : "");
    if (message && fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearResume = () => {
    setResume(null);
    setError("resume", "");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetForm = () => {
    setFormValues({
      full_name: "",
      email: "",
      mobile: "",
      opening_id: "",
      experience_years: "",
      current_company: "",
      referral_employee_name: "",
      referral_employee_code: "",
      referral_employee_branch: "",
      referral_employee_contact: "",
    });
    setHasReferral(false);
    setStep(1);
    clearResume();
    setErrors({});
    setCaptchaToken("");
    setCaptchaNonce((n) => n + 1);
  };

  // Validates everything on the visible step and moves focus to the first
  // problem so long forms do not hide the reason a submit did nothing
  const validateStep = () => {
    const found = {};
    stepFields.forEach((field) => {
      found[field] = errorFor(field);
    });
    if (step === 2) {
      found.referral_employee_code = errorFor("referral_employee_code");
      found.referral_employee_branch = errorFor("referral_employee_branch");
    }
    setErrors((prev) => ({ ...prev, ...found }));

    const firstBad = Object.keys(found).find((field) => found[field]);
    if (firstBad) {
      const node = formRef.current?.querySelector(
        firstBad === "resume" ? "#resume-upload-trigger" : `[name="${firstBad}"]`
      );
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      node?.focus({ preventScroll: true });
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;
    if (!validateStep()) return;

    // The same button advances to the referral step before it submits
    if (!isLastStep) {
      setStep(2);
      return;
    }
    // Step 1 stays authoritative even when the referral step is on screen
    if (hasReferral) {
      const stale = {};
      STEP_1_FIELDS.forEach((field) => {
        stale[field] = errorFor(field);
      });
      if (Object.values(stale).some(Boolean)) {
        setErrors((prev) => ({ ...prev, ...stale }));
        setStep(1);
        return;
      }
    }
    if (captchaEnabled() && !captchaToken) {
      setError("captcha", "Please complete the security check.");
      return;
    }
    setError("captcha", "");

    setIsSubmitting(true);

    try {
      const data = new FormData();
      data.append("full_name", formValues.full_name.trim());
      data.append("email", formValues.email.trim());
      data.append("mobile", formValues.mobile.trim());
      data.append("opening_id", formValues.opening_id);
      data.append("experience_years", formValues.experience_years.trim());
      data.append("current_company", formValues.current_company.trim());
      if (hasReferral) {
        data.append("referral_employee_name", formValues.referral_employee_name.trim());
        data.append("referral_employee_code", formValues.referral_employee_code.trim());
        data.append("referral_employee_branch", formValues.referral_employee_branch.trim());
        data.append("referral_employee_contact", formValues.referral_employee_contact.trim());
      }
      data.append("resume", resume);
      data.append("attribution", getAttribution());
      if (captchaToken) data.append("captcha_token", captchaToken);
      // Proves this form was fetched from the portal and took a human amount of
      // time to fill in. Absent only if the request for it failed, in which case
      // the server decides whether to insist.
      if (formToken) data.append("form_token", formToken);
      data.append(HONEYPOT_FIELD, honeypot);

      await submitApplication(data);

      setSubmitted(true);
      setIsSubmitting(false);
      resetForm();
    } catch (error) {
      setIsSubmitting(false);
      // The token was consumed by the attempt, valid or not
      setCaptchaToken("");
      setCaptchaNonce((n) => n + 1);
      const message = error.response?.data?.error;
      notify.error(message || "Submission failed. Please try again later.");
    }
  };

  if (submitted) {
    return (
      <div className="px-6 py-12 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
          <svg className="h-8 w-8 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path className="check-draw" strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h3 className="mb-2 text-xl font-semibold text-stone-900">Application submitted</h3>
        <p className="mx-auto mb-8 max-w-xs text-sm leading-relaxed text-stone-500">
          Thank you for applying. Our HR team will review your application and
          reach out to you soon.
        </p>

        <button
          type="button"
          onClick={() => {
            setSubmitted(false);
            if (onSuccess) onSuccess();
          }}
          className="rounded-lg bg-[#a81724] px-10 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#8f131f]"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="px-5 py-6 sm:px-7 sm:py-7">
      {/* Honeypot. Hidden from sight, from screen readers and from the tab
          order, so no applicant can reach it - but present in the DOM, which is
          all a form-filling bot looks at. */}
      <div aria-hidden="true" className="absolute w-px h-px -left-[9999px] overflow-hidden">
        <label htmlFor={HONEYPOT_FIELD}>Company website</label>
        <input
          id={HONEYPOT_FIELD}
          type="text"
          name={HONEYPOT_FIELD}
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="mb-6">
        <h3 className="text-lg font-semibold text-stone-900">Job Application</h3>
        <p className="mt-0.5 text-sm text-stone-500">
          {step === 1
            ? "Tell us about yourself and attach your resume."
            : "Who referred you to us?"}
        </p>

        {/* The referral step only exists when the applicant opts in */}
        {hasReferral && (
          <div className="mt-4 flex items-center gap-2">
            <span className={`h-1 flex-1 rounded-full ${step >= 1 ? "bg-[#a81724]" : "bg-stone-200"}`} />
            <span className={`h-1 flex-1 rounded-full ${step >= 2 ? "bg-[#a81724]" : "bg-stone-200"}`} />
            <span className="ml-1 text-xs font-medium text-stone-400">Step {step} of 2</span>
          </div>
        )}
      </div>

      {step === 1 ? (
        <div className="space-y-4">
          <div className="flex flex-col">
            <label className={labelClass} htmlFor="full_name">Full name</label>
            <input
              id="full_name"
              type="text"
              name="full_name"
              maxLength={120}
              autoComplete="name"
              onChange={handleChange}
              onBlur={handleBlur}
              value={formValues.full_name}
              aria-invalid={!!errors.full_name}
              className={inputClass(errors.full_name)}
              placeholder="Enter your full name"
            />
            {errors.full_name && <p className={errorClass}>{errors.full_name}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col">
              <label className={labelClass} htmlFor="email">Email ID</label>
              <input
                id="email"
                type="email"
                name="email"
                maxLength={160}
                autoComplete="email"
                onChange={handleChange}
                onBlur={handleBlur}
                value={formValues.email}
                aria-invalid={!!errors.email}
                className={inputClass(errors.email)}
                placeholder="you@example.com"
              />
              {errors.email && <p className={errorClass}>{errors.email}</p>}
            </div>

            <div className="flex flex-col">
              <label className={labelClass} htmlFor="mobile">Mobile number</label>
              <div
                className={`flex items-center rounded-lg border bg-white transition focus-within:ring-2 focus-within:ring-[#a81724]/15 ${
                  errors.mobile ? "border-[#b91c1c]" : "border-stone-200 focus-within:border-[#a81724]"
                }`}
              >
                <span className="pl-3 pr-2 text-sm text-stone-400">+91</span>
                <input
                  id="mobile"
                  type="tel"
                  inputMode="numeric"
                  name="mobile"
                  autoComplete="tel-national"
                  onChange={handleDigitsChange}
                  onBlur={handleBlur}
                  value={formValues.mobile}
                  aria-invalid={!!errors.mobile}
                  placeholder="10 digit number"
                  className="w-full min-w-0 rounded-r-lg bg-transparent py-2.5 pr-3 text-sm text-stone-900 placeholder-stone-400 outline-none"
                />
              </div>
              {errors.mobile && <p className={errorClass}>{errors.mobile}</p>}
            </div>
          </div>

          <div className="flex flex-col">
            <label className={labelClass} htmlFor="opening_id">Position applying for</label>
            <div className="relative">
              <select
                id="opening_id"
                name="opening_id"
                value={formValues.opening_id}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={!!errors.opening_id}
                className={`${inputClass(errors.opening_id)} appearance-none pr-10 ${
                  formValues.opening_id ? "" : "text-stone-400"
                }`}
              >
                {/* Placeholder: shown as the empty state, never offered as a choice */}
                <option value="" disabled hidden>
                  Select a position
                </option>
                {openings.map((opening) => (
                  <option key={opening.id} value={opening.id} className="text-stone-900">
                    {opening.position} — {opening.branch}
                  </option>
                ))}
              </select>
              <svg
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {errors.opening_id && <p className={errorClass}>{errors.opening_id}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col">
              <label className={labelClass} htmlFor="experience_years">Years of experience</label>
              <input
                id="experience_years"
                type="number"
                name="experience_years"
                min="0"
                max="60"
                step="0.5"
                onChange={handleChange}
                onBlur={handleBlur}
                value={formValues.experience_years}
                aria-invalid={!!errors.experience_years}
                className={inputClass(errors.experience_years)}
                placeholder="e.g. 3"
              />
              {errors.experience_years && <p className={errorClass}>{errors.experience_years}</p>}
            </div>

            <div className="flex flex-col">
              <label className={labelClass} htmlFor="current_company">Currently working in</label>
              <input
                id="current_company"
                type="text"
                name="current_company"
                maxLength={120}
                onChange={handleChange}
                onBlur={handleBlur}
                value={formValues.current_company}
                aria-invalid={!!errors.current_company}
                className={inputClass(errors.current_company)}
                placeholder='School / organisation, or "Fresher"'
              />
              {errors.current_company && <p className={errorClass}>{errors.current_company}</p>}
            </div>
          </div>

          <div className="flex flex-col">
            <label className={labelClass}>Resume</label>
            <input
              ref={fileInputRef}
              type="file"
              name="resume"
              accept=".pdf,application/pdf"
              onChange={handleResumeChange}
              className="hidden"
              id="resume-upload"
            />
            {resume ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5">
                <svg className="h-4 w-4 shrink-0 text-[#a81724]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="min-w-0 flex-1 truncate text-sm text-stone-800" title={resume.name}>
                  {resume.name}
                </span>
                <span className="shrink-0 text-xs text-stone-400">
                  {(resume.size / (1024 * 1024)).toFixed(2)} MB
                </span>
                <button
                  type="button"
                  onClick={clearResume}
                  aria-label="Remove resume"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-200 hover:text-[#a81724]"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                id="resume-upload-trigger"
                onClick={() => fileInputRef.current?.click()}
                className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed bg-stone-50/60 px-3 py-3.5 text-sm transition-colors hover:border-[#a81724] hover:text-[#a81724] ${
                  errors.resume ? "border-[#b91c1c] text-[#b91c1c]" : "border-stone-300 text-stone-500"
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12l-4 4m4-4l4 4" />
                </svg>
                Upload resume · PDF only, max {MAX_RESUME_MB} MB
              </button>
            )}
            {errors.resume && <p className={errorClass}>{errors.resume}</p>}
          </div>

          <label className="flex cursor-pointer select-none items-center gap-2.5 pt-0.5">
            <input
              type="checkbox"
              checked={hasReferral}
              onChange={(e) => {
                setHasReferral(e.target.checked);
                if (!e.target.checked) {
                  setStep(1);
                  setErrors((prev) => ({
                    ...prev,
                    referral_employee_name: "",
                    referral_employee_contact: "",
                    referral_employee_code: "",
                    referral_employee_branch: "",
                  }));
                }
              }}
              className="h-4 w-4 cursor-pointer rounded border-stone-300 accent-[#a81724]"
            />
            <span className="text-sm text-stone-600">I was referred by an employee</span>
          </label>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col">
              <label className={labelClass} htmlFor="referral_employee_name">Employee name</label>
              <input
                id="referral_employee_name"
                type="text"
                name="referral_employee_name"
                maxLength={120}
                onChange={handleChange}
                onBlur={handleBlur}
                value={formValues.referral_employee_name}
                aria-invalid={!!errors.referral_employee_name}
                className={inputClass(errors.referral_employee_name)}
                placeholder="Referring employee's name"
              />
              {errors.referral_employee_name && (
                <p className={errorClass}>{errors.referral_employee_name}</p>
              )}
            </div>

            <div className="flex flex-col">
              <label className={labelClass} htmlFor="referral_employee_contact">Employee mobile</label>
              <div
                className={`flex items-center rounded-lg border bg-white transition focus-within:ring-2 focus-within:ring-[#a81724]/15 ${
                  errors.referral_employee_contact
                    ? "border-[#b91c1c]"
                    : "border-stone-200 focus-within:border-[#a81724]"
                }`}
              >
                <span className="pl-3 pr-2 text-sm text-stone-400">+91</span>
                <input
                  id="referral_employee_contact"
                  type="tel"
                  inputMode="numeric"
                  name="referral_employee_contact"
                  onChange={handleDigitsChange}
                  onBlur={handleBlur}
                  value={formValues.referral_employee_contact}
                  aria-invalid={!!errors.referral_employee_contact}
                  className="w-full min-w-0 rounded-r-lg bg-transparent py-2.5 pr-3 text-sm text-stone-900 placeholder-stone-400 outline-none"
                  placeholder="10 digit number"
                />
              </div>
              {errors.referral_employee_contact && (
                <p className={errorClass}>{errors.referral_employee_contact}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col">
              <label className={labelClass} htmlFor="referral_employee_code">
                Employee ID <span className="font-normal text-stone-400">(optional)</span>
              </label>
              <input
                id="referral_employee_code"
                type="text"
                name="referral_employee_code"
                maxLength={40}
                onChange={handleChange}
                onBlur={handleBlur}
                value={formValues.referral_employee_code}
                className={inputClass(errors.referral_employee_code)}
                placeholder="e.g. EMP123"
              />
              {errors.referral_employee_code && (
                <p className={errorClass}>{errors.referral_employee_code}</p>
              )}
            </div>

            <div className="flex flex-col">
              <label className={labelClass} htmlFor="referral_employee_branch">
                Department <span className="font-normal text-stone-400">(optional)</span>
              </label>
              <input
                id="referral_employee_branch"
                type="text"
                name="referral_employee_branch"
                maxLength={120}
                onChange={handleChange}
                onBlur={handleBlur}
                value={formValues.referral_employee_branch}
                className={inputClass(errors.referral_employee_branch)}
                placeholder="e.g. Primary Wing, Admin"
              />
              {errors.referral_employee_branch && (
                <p className={errorClass}>{errors.referral_employee_branch}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Renders only when a Turnstile site key is configured */}
      {isLastStep && (
        <div className="mt-5">
          <Turnstile
            onChange={(token) => {
              setCaptchaToken(token);
              if (token) setError("captcha", "");
            }}
            resetKey={captchaNonce}
            theme="light"
            className="flex justify-center"
          />
          {errors.captcha && <p className={`${errorClass} text-center`}>{errors.captcha}</p>}
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        {step === 2 && (
          <button
            type="button"
            onClick={() => setStep(1)}
            className="rounded-lg border border-stone-200 px-5 py-2.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50"
          >
            Back
          </button>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors ${
            isSubmitting
              ? "cursor-not-allowed bg-stone-100 text-stone-400"
              : "bg-[#a81724] text-white hover:bg-[#8f131f]"
          }`}
        >
          {isSubmitting ? (
            <>
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Submitting…
            </>
          ) : isLastStep ? (
            "Submit application"
          ) : (
            <>
              Continue
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </>
          )}
        </button>
      </div>
    </form>
  );
};

export default HeroApplicationForm;
