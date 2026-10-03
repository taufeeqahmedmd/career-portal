// The branch filter that campaign links carry, e.g. /pgos?branch=thumukunta.
//
// It is not a browsing convenience like the search box or the position
// dropdown: a hiring campaign is run for ONE branch, and every opening the
// visitor can reach from that link has to belong to it. The submitted
// application takes its branch from the opening the candidate picked, so a
// position list that reaches wider is how a lead ends up on another branch.
//
// Both the listing and the application form read the filter through here, so
// the two can never disagree about what the link meant.

// `?branch=nacharam` is the documented form; a bare `?=nacharam` is accepted
// because campaign links have been built that way.
export const readBranchFilter = (searchParams) =>
  (searchParams.get("branch") || searchParams.get("") || "").trim();

// Substring, case-insensitive: links carry a short token ("thumukunta") rather
// than the full branch name ("Pallavi Model School, Thumukunta").
export const matchesBranch = (opening, branchFilter) =>
  !branchFilter || (opening.branch || "").toLowerCase().includes(branchFilter.toLowerCase());

// Note there is deliberately no "clear the branch" helper. The listing used to
// show a dismissible chip and a reset button that both dropped it, which let a
// candidate who arrived from a single-branch ad reach every other branch in one
// click. Leaving the page is still possible through normal navigation - it just
// is not offered as a control on the campaign's own landing page.
export const filterByBranch = (openings, branchFilter) =>
  branchFilter ? openings.filter((o) => matchesBranch(o, branchFilter)) : openings;
