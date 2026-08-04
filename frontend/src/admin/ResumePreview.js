import React, { useEffect, useRef, useState } from "react";
import { getApplicationResume } from "../services/api";

// Displaying a candidate's resume inside the portal.
//
// Resumes are private - fetched as a blob through the authenticated,
// scope-checked endpoint rather than linked to on Drive. That leaves only the
// browser's own viewer, and browsers can render PDFs but not Word documents:
// an <iframe> pointed at a .docx downloads it instead of showing it. So Word
// files are rendered here, in the page, from the same blob.
//
//   PDF   -> <iframe>, the browser's native viewer
//   DOCX  -> docx-preview, rendered into a div
//   DOC   -> the legacy binary format. No browser library reads it, so it is
//            offered as a download with an explanation, not a blank pane.

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC = "application/msword";

const kindOf = (mimeType = "") => {
  const type = String(mimeType).split(";")[0].trim().toLowerCase();
  if (type === PDF) return "pdf";
  if (type === DOCX) return "docx";
  if (type === DOC) return "doc";
  return "other";
};

// Loads the resume once per applicant. Returns everything the page needs -
// the object URL for Download/Open, the blob for in-page rendering, and the
// detected kind - so the file is never fetched twice.
export const useResume = (applicationId, hasResume) => {
  const [state, setState] = useState({ status: "idle" });

  useEffect(() => {
    if (!applicationId || !hasResume) {
      setState({ status: "none" });
      return undefined;
    }

    let objectUrl = null;
    let cancelled = false;
    setState({ status: "loading" });

    getApplicationResume(applicationId)
      .then((res) => {
        if (cancelled) return;
        const blob = res.data;
        objectUrl = URL.createObjectURL(blob);
        setState({
          status: "ready",
          url: objectUrl,
          blob,
          kind: kindOf(blob.type || res.headers?.["content-type"]),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            err.response?.status === 404
              ? "The stored resume could not be found."
              : "The resume could not be loaded.",
        });
      });

    return () => {
      cancelled = true;
      // Object URLs pin the file in memory until they are released
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [applicationId, hasResume]);

  return state;
};

const Centered = ({ children }) => (
  <div className="h-[50vh] flex flex-col items-center justify-center gap-2 text-center px-6">
    {children}
  </div>
);

const ResumePreview = ({ resume, applicantName }) => {
  const docxRef = useRef(null);
  const { status, kind, url, blob } = resume;

  // Render the Word document once the blob is in hand. docx-preview is loaded
  // on demand so its bulk never lands in the initial bundle.
  useEffect(() => {
    if (status !== "ready" || kind !== "docx" || !docxRef.current) return undefined;

    let cancelled = false;
    const container = docxRef.current;
    container.innerHTML = "";

    import("docx-preview")
      .then(({ renderAsync }) => {
        if (cancelled) return null;
        return renderAsync(blob, container, null, {
          className: "docx",
          inWrapper: true,
          ignoreHeight: true, // let pages grow rather than clip
          breakPages: true,
          experimental: true, // better table and numbering support
          useBase64URL: true, // embedded images render without extra requests
        });
      })
      .catch(() => {
        if (cancelled) return;
        container.innerHTML =
          '<p style="padding:2rem;text-align:center;color:#948d88;font-size:0.875rem">' +
          "This Word document could not be displayed. Use Download to open it in Word." +
          "</p>";
      });

    return () => {
      cancelled = true;
    };
  }, [status, kind, blob]);

  const frameClass = "w-full h-[70vh] lg:h-[calc(100vh-180px)] bg-stone-100";

  if (status === "none") {
    return (
      <Centered>
        <p className="text-sm font-medium text-stone-500">No resume on file</p>
        <p className="text-xs text-[#948d88]">
          This application was submitted without an accessible resume.
        </p>
      </Centered>
    );
  }

  if (status === "loading" || status === "idle") {
    return (
      <Centered>
        <span className="w-7 h-7 rounded-full border-2 border-[#e7e4e1] border-t-[#a81724] animate-spin" />
        <p className="text-sm text-[#948d88] mt-1">Loading resume…</p>
      </Centered>
    );
  }

  if (status === "error") {
    return (
      <Centered>
        <p className="text-sm font-medium text-stone-500">{resume.message}</p>
        <p className="text-xs text-[#948d88]">
          Try again, or ask an administrator to check the storage configuration.
        </p>
      </Centered>
    );
  }

  if (kind === "pdf") {
    return <iframe title={`Resume — ${applicantName}`} src={url} className={frameClass} />;
  }

  if (kind === "docx") {
    // docx-preview lays out fixed-width pages, so the wrapper scrolls
    return (
      <div className={`${frameClass} overflow-auto`}>
        <div ref={docxRef} className="docx-preview-host" />
      </div>
    );
  }

  return (
    <Centered>
      <p className="text-sm font-medium text-stone-500">
        {kind === "doc" ? "Word 97–2003 document" : "This file cannot be displayed"}
      </p>
      <p className="text-xs text-[#948d88] max-w-sm">
        {kind === "doc"
          ? "The older .doc format cannot be shown in a browser. Use Download to open it in Word."
          : "Use Download to open this file on your computer."}
      </p>
    </Centered>
  );
};

export default ResumePreview;
