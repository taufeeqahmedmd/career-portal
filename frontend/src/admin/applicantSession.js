// The applicant profile route carries no id in the URL, so the id is held in
// sessionStorage. It is per-tab and survives a refresh, which is what the
// profile page needs to reload itself.
const KEY = "admin_active_applicant";

export const setActiveApplicantId = (id) => {
  if (id == null) return;
  try {
    sessionStorage.setItem(KEY, String(id));
  } catch {}
};

export const getActiveApplicantId = () => {
  try {
    return sessionStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
};

// Signing out has to drop it: on a shared machine the next person to sign in
// would otherwise land on the previous user's last-viewed applicant
export const clearActiveApplicantId = () => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
};
