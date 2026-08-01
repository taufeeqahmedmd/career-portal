import React, { useEffect, useRef } from "react";
import { FiX } from "react-icons/fi";
import HeroApplicationForm from "./HeroApplicationForm";

const ApplicationFormModal = ({ selectedOpening, openings, onClose, onSuccess }) => {
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);

  // Lock page scroll, trap focus inside the dialog, and restore focus on close
  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    document.body.style.overflow = "hidden";

    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      );
    focusable()[0]?.focus();

    const handleKey = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", handleKey);
      if (returnFocusRef.current instanceof HTMLElement) returnFocusRef.current.focus();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Job application form"
      ref={panelRef}
      className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-6 overflow-y-auto"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      ></div>

      {/* Modal card */}
      <div className="relative w-full max-w-lg my-auto">
        <div className="relative bg-white rounded-2xl shadow-xl ring-1 ring-stone-200">
          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="Close application form"
            className="absolute top-4 right-4 z-10 w-8 h-8 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 flex items-center justify-center transition-colors"
          >
            <FiX size={18} />
          </button>

          <HeroApplicationForm
            selectedOpening={selectedOpening}
            openings={openings}
            onSuccess={onSuccess}
          />
        </div>
      </div>
    </div>
  );
};

export default ApplicationFormModal;
