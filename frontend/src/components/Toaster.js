import React from "react";
import { toast, ToastContainer, cssTransition } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "../styles/toast.css";

// One place for how notifications look across the whole app.
// Use `notify.success("...")` etc. instead of calling toast directly.

const ICON_PATHS = {
  success: "M5 13l4 4L19 7",
  error: "M18 6L6 18M6 6l12 12",
  warning: "M12 8v5m0 3.5h.01",
  info: "M12 8h.01M12 11v5",
};

const ToastIcon = ({ type }) => (
  <span className={`app-toast-dot app-toast-dot--${type || "info"}`}>
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICON_PATHS[type] || ICON_PATHS.info} />
    </svg>
  </span>
);

const CloseButton = ({ closeToast }) => (
  <button
    onClick={closeToast}
    aria-label="Dismiss notification"
    className="app-toast-close"
    type="button"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  </button>
);

export const notify = {
  success: (text, opts) => toast.success(text, opts),
  error: (text, opts) => toast.error(text, opts),
  warning: (text, opts) => toast.warning(text, opts),
  info: (text, opts) => toast.info(text, opts),
};

const AppTransition = cssTransition({
  enter: "app-toast-enter",
  exit: "app-toast-exit",
});

const Toaster = () => (
  <ToastContainer
    position="bottom-right"
    transition={AppTransition}
    autoClose={3000}
    hideProgressBar
    newestOnTop
    closeOnClick
    pauseOnHover
    draggable
    limit={3}
    icon={ToastIcon}
    closeButton={CloseButton}
  />
);

export default Toaster;
