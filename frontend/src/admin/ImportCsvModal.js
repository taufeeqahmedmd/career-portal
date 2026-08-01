import React, { useRef, useState } from "react";
import { notify } from "../components/Toaster";
import { card, btnDark } from "./ui";

// Shared bulk-import dialog: pick a CSV, upload, then show what happened.
// `columns` documents the template; `onImport(file)` performs the upload.
const ImportCsvModal = ({ title, description, columns, sample, onImport, onClose, onDone }) => {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const downloadTemplate = () => {
    const header = columns.map((c) => c.name).join(",");
    const csv = `${header}\r\n${(sample || []).join("\r\n")}\r\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, "-")}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await onImport(file);
      setResult(res.data);
      if (res.data.imported > 0) onDone?.();
    } catch (err) {
      notify.error(err.response?.data?.error || "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className={`${card} p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto pointer-events-auto`}
        >
          <h3 className="font-poppins text-lg font-semibold text-[#2a2426]">{title}</h3>
          <p className="text-xs text-[#948d88] mt-1 leading-relaxed">{description}</p>

          {/* Column reference */}
          <div className="mt-4 rounded-xl border border-[#efece9] overflow-hidden">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#948d88] px-3 py-2 bg-stone-50">
              Columns
            </p>
            <ul className="divide-y divide-[#f3f1ee]">
              {columns.map((c) => (
                <li key={c.name} className="flex items-start gap-3 px-3 py-2">
                  <code className="font-mono text-[11px] text-[#2a2426] bg-stone-100 rounded px-1.5 py-0.5 shrink-0">
                    {c.name}
                  </code>
                  <span className="text-[11px] text-stone-500 leading-relaxed">
                    {c.required ? (
                      <span className="text-[#a81724] font-semibold">Required. </span>
                    ) : (
                      <span className="text-[#948d88]">Optional. </span>
                    )}
                    {c.note}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            onClick={downloadTemplate}
            className="text-xs font-semibold text-[#a81724] hover:underline mt-3"
          >
            Download template CSV →
          </button>

          {/* File picker */}
          <div className="mt-4">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setResult(null);
              }}
              className="hidden"
              id="csv-import-input"
            />
            <label
              htmlFor="csv-import-input"
              className="flex items-center justify-center gap-2 border border-dashed border-[#d8d3cf] rounded-xl px-4 py-4 text-sm text-stone-600 cursor-pointer hover:bg-stone-50 transition-colors"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2 M12 4v12m0-12l-4 4m4-4l4 4" />
              </svg>
              {file ? file.name : "Choose a CSV file"}
            </label>
          </div>

          {/* Outcome */}
          {result && (
            <div className="mt-4 rounded-xl border border-[#efece9] p-3.5">
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="text-emerald-700 font-semibold">{result.imported} imported</span>
                <span className="text-stone-500">{result.skipped} skipped (already exist)</span>
                {result.failed > 0 && (
                  <span className="text-[#dc2626] font-semibold">{result.failed} failed</span>
                )}
              </div>
              {result.errors?.length > 0 && (
                <ul className="mt-3 space-y-1 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <li key={i} className="text-[11px] text-stone-600">
                      <span className="font-mono text-[#948d88]">Row {e.row}</span>{" "}
                      <span className="font-semibold">{e.value}</span> — {e.reason}
                    </li>
                  ))}
                </ul>
              )}
              {/* Passwords only come back when the welcome email could not be sent */}
              {result.created?.some((c) => c.password) && (
                <div className="mt-3 pt-3 border-t border-[#f0edea]">
                  <p className="text-[11px] font-semibold text-amber-700 mb-1.5">
                    Email is not configured — share these credentials manually:
                  </p>
                  <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                    {result.created
                      .filter((c) => c.password)
                      .map((c) => (
                        <li key={c.email} className="font-mono text-[11px] text-stone-600">
                          {c.email} · {c.password}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 mt-5">
            {!result || result.imported === 0 ? (
              <button
                onClick={run}
                disabled={!file || busy}
                className={`${btnDark} !px-5 !py-2.5 text-sm disabled:opacity-50`}
              >
                {busy ? "Importing…" : "Import"}
              </button>
            ) : null}
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-full text-sm font-semibold text-stone-600 hover:bg-stone-100 transition-colors"
            >
              {result ? "Close" : "Cancel"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default ImportCsvModal;
