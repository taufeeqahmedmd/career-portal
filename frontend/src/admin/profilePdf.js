import jsPDF from "jspdf";

// Colors matching the admin theme
const DARK = "#2a2426";
const GRAY = "#948d88";
const ACCENT = "#a81724";
const LINE = "#e7e4e1";

const PAGE_W = 595; // A4 portrait, pt
const PAGE_H = 842;
const MARGIN = 48;
const LABEL_W = 150;
const VALUE_W = PAGE_W - MARGIN * 2 - LABEL_W;

const humanize = (key) =>
  String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const formatDateTime = (value) => {
  if (!value) return "";
  const raw = String(value);
  // Accepts both the old "YYYY-MM-DD HH:MM:SS" (UTC) and ISO timestamps
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function downloadProfilePdf({ application: a, rounds = [], stages = [] }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = MARGIN;

  const stageLabel = (key) => {
    if (!key) return "";
    const s = stages.find((x) => x.key === key);
    return s ? s.label : humanize(key);
  };

  const ensureSpace = (needed) => {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const sectionTitle = (title) => {
    ensureSpace(40);
    y += 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(ACCENT);
    doc.text(title.toUpperCase(), MARGIN, y);
    y += 6;
    doc.setDrawColor(LINE);
    doc.setLineWidth(0.75);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 14;
  };

  const row = (label, value, { link } = {}) => {
    const text = String(value == null ? "" : value).trim();
    if (!text) return;
    const lines = doc.splitTextToSize(text, VALUE_W);
    ensureSpace(lines.length * 13 + 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(GRAY);
    doc.text(label.toUpperCase(), MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    if (link) {
      doc.setTextColor("#1d4ed8");
      doc.textWithLink(lines[0], MARGIN + LABEL_W, y, { url: link });
      lines.slice(1).forEach((l, i) => doc.text(l, MARGIN + LABEL_W, y + (i + 1) * 13));
    } else {
      doc.setTextColor(DARK);
      doc.text(lines, MARGIN + LABEL_W, y);
    }
    y += lines.length * 13 + 6;
  };

  // ---- Header ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(DARK);
  doc.text(a.full_name || "Applicant", MARGIN, y + 8);
  y += 26;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(GRAY);
  doc.text(`${a.position || ""}${a.branch ? ` · ${a.branch}` : ""}`, MARGIN, y);
  y += 10;

  // ---- Candidate details ----
  sectionTitle("Candidate Details");
  row("Mobile", a.mobile);
  row("Email", a.email);
  row("Experience", a.experience_years ? `${a.experience_years} years` : "");
  row("Currently Working At", a.current_company);
  row("Qualification", a.qualification);

  // ---- Application ----
  sectionTitle("Application Details");
  row("Position", a.position);
  row("Branch", a.branch);
  row("School Group", a.school_group);
  row("Submitted", formatDateTime(a.created_at));
  row("Application ID", a.id ? `#${a.id}` : "");

  // ---- Referred by ----
  if (a.referral_employee_code || a.referral_employee_name) {
    sectionTitle("Referred By");
    row("Employee Name", a.referral_employee_name);
    row("Employee ID", a.referral_employee_code);
    row("Department", a.referral_employee_branch);
    row("Mobile", a.referral_employee_contact);
  }

  // ---- Screening ----
  const hasScreening =
    a.screening_status ||
    a.screening_experience ||
    a.screening_current_salary ||
    a.screening_expected_salary ||
    a.screening_location ||
    a.screening_comments;
  if (hasScreening) {
    sectionTitle("Screening");
    row("Experience", a.screening_experience);
    row("Current Salary", a.screening_current_salary);
    row("Expectation", a.screening_expected_salary);
    row("Current Location", a.screening_location);
    row("Willing to Relocate", a.screening_relocate ? "Yes" : "No");
    row("Comments", a.screening_comments);
    row("Profile Status", stageLabel(a.screening_status));
    // A referred lead still runs interviews, so the referral and the gate are
    // both shown - printing one instead of the other left a referred candidate
    // with no answer to "next round?" at all
    if (a.referred_entity && a.referred_branch) {
      row("Referred To Branch", `${a.referred_branch} (${a.referred_entity})`);
    }
    row("Next Interview Round", a.screening_next_round ? "Yes" : "No");
  }

  // ---- Referral origin ----
  if (a.referral_employee_name || a.referral_employee_code) {
    sectionTitle("Referred By");
    row("Employee Name", a.referral_employee_name);
    row("Employee ID", a.referral_employee_code);
    row("Department", a.referral_employee_branch);
    row("Mobile", a.referral_employee_contact);
  }

  // ---- Interview rounds ----
  // Only rounds the flow still considers open. Closing the screening gate
  // hides them on screen, so printing them would contradict the Screening
  // block printed just above.
  (a.screening_next_round ? [...rounds] : [])
    .sort((r1, r2) => r1.round_no - r2.round_no)
    .forEach((r) => {
      sectionTitle(`Interview Feedback - Round ${r.round_no}`);
      row("Assigned To", r.assigned_name || r.assigned_to_name);
      row("Profile Status", stageLabel(r.status));
      row("Comments", r.feedback);
      row("Next Interview Round", r.next_round ? "Yes" : "No");
      if (r.updated_by_name) {
        row("Last Updated", `${r.updated_by_name} · ${formatDateTime(r.updated_at)}`);
      }
    });

  // ---- Suggestion ----
  if (a.suggested_role) {
    sectionTitle("Suggested for Different Role");
    row("Suggested Role", a.suggested_role);
  }

  // ---- Resume ----
  // Deliberately not a link. This PDF gets emailed and forwarded, and the
  // resume is candidate personal data behind a sign-in - a URL in here would
  // be an invitation to route around that.
  if (a.resume_link || a.resume_file_id) {
    sectionTitle("Resume");
    row("Resume", "On file - open this candidate in the Careers portal to view it");
  }

  // ---- Footer on every page ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(GRAY);
    doc.text(
      `Careers Portal · Applicant profile generated ${new Date().toLocaleString("en-IN")}`,
      MARGIN,
      PAGE_H - 24
    );
    doc.text(`Page ${p} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 24, { align: "right" });
  }

  const safeName = String(a.full_name || "applicant")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  doc.save(`${safeName}_profile.pdf`);
}
