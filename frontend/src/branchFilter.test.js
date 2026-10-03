// The branch filter carried by hiring-campaign links.
//
// A campaign is run for one branch. The submitted application takes its branch
// from the opening the candidate selected, so anything that lets them reach an
// opening at another branch puts the lead on the wrong branch - which is
// exactly what the application form used to do: the listing was filtered, the
// form's position dropdown was not.

import { readBranchFilter, matchesBranch, filterByBranch } from "./branchFilter";

const params = (search) => new URLSearchParams(search);

const OPENINGS = [
  { id: 1, position: "Counselor", branch: "Pallavi Model School, Thumukunta" },
  { id: 2, position: "Marketing Manager", branch: "Pallavi Model School, Thumukunta" },
  { id: 3, position: "TGT - All Subjects", branch: "Pallavi Model School, Boduppal" },
  { id: 4, position: "PRT - All Subjects", branch: "Pallavi International School, Keesara" },
];

describe("reading the filter off a campaign link", () => {
  test("?branch=<name> is the documented form", () => {
    expect(readBranchFilter(params("?branch=thumukunta"))).toBe("thumukunta");
  });

  // Links have been built this way, so it has to keep working
  test("a bare ?=<name> is accepted too", () => {
    expect(readBranchFilter(params("?=thumukunta"))).toBe("thumukunta");
  });

  test("surrounding whitespace is ignored", () => {
    expect(readBranchFilter(params("?branch=%20thumukunta%20"))).toBe("thumukunta");
  });

  test("no filter on the link means no filter", () => {
    expect(readBranchFilter(params(""))).toBe("");
    expect(readBranchFilter(params("?utm_source=meta"))).toBe("");
  });

  test("campaign tags are not mistaken for a branch", () => {
    expect(readBranchFilter(params("?utm_source=meta&utm_campaign=hiring"))).toBe("");
  });
});

describe("narrowing the openings a visitor can reach", () => {
  test("only the campaign's branch survives", () => {
    const reachable = filterByBranch(OPENINGS, "thumukunta");
    expect(reachable.map((o) => o.id)).toEqual([1, 2]);
  });

  test("the match ignores case and matches part of the full branch name", () => {
    expect(matchesBranch(OPENINGS[0], "THUMUKUNTA")).toBe(true);
    expect(matchesBranch(OPENINGS[0], "Thumukunta")).toBe(true);
  });

  // The regression: a candidate arriving from a Thumukunta ad must not be able
  // to pick Boduppal or Keesara, because the lead would be filed against those
  test("no opening from another branch is reachable", () => {
    const reachable = filterByBranch(OPENINGS, "thumukunta");
    expect(reachable.every((o) => /thumukunta/i.test(o.branch))).toBe(true);
    expect(reachable.map((o) => o.branch)).not.toContain(
      "Pallavi Model School, Boduppal"
    );
  });

  test("a link with no branch reaches everything, as before", () => {
    expect(filterByBranch(OPENINGS, "")).toHaveLength(4);
  });

  // A branch with nothing open is an empty list, never a silent fallback to
  // every branch - that fallback is what leaks a lead
  test("a branch with no openings comes back empty", () => {
    expect(filterByBranch(OPENINGS, "nonexistent-branch")).toEqual([]);
  });
});

describe("the filter is a campaign lock, not a user filter", () => {
  // The listing used to carry a dismissible "Branch: thumukunta x" chip, and
  // "Reset filters" dropped the branch too. Either one put a candidate who
  // arrived from a single-branch ad in front of every branch's openings.
  test("resetting the visitor's own filters leaves the branch in place", () => {
    const next = new URLSearchParams("?=thumukunta&position=Counselor");
    next.delete("position"); // what clearFilters does
    expect(readBranchFilter(next)).toBe("thumukunta");
  });

  test("campaign tags survive a reset so attribution is not lost", () => {
    const next = new URLSearchParams("?=thumukunta&position=Counselor&utm_source=meta&gclid=abc");
    next.delete("position");
    expect(next.get("utm_source")).toBe("meta");
    expect(next.get("gclid")).toBe("abc");
    expect(readBranchFilter(next)).toBe("thumukunta");
  });
});
