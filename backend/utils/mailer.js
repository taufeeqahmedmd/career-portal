const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const LOGO_DIR = path.join(__dirname, '..', 'assets', 'email');
const LOGOS = [
  { file: 'logo-pallavi.png', cid: 'logo-pallavi', alt: 'Pallavi Group of Schools' },
  { file: 'logo-dps.png', cid: 'logo-dps', alt: 'Delhi Public School' },
].filter((l) => fs.existsSync(path.join(LOGO_DIR, l.file)));

// SMTP is optional: when unconfigured, sends are skipped and callers are told.
// Required env: SMTP_HOST, SMTP_USER, SMTP_PASS
// Optional env: SMTP_PORT (587), SMTP_SECURE (auto from port), MAIL_FROM, APP_URL

const NAVY = '#1e3a8a';
const NAVY_DARK = '#182f6e';
const MAROON = '#a81724';
const INK = '#17161c';

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transporter() {
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// Human descriptions for what each permission lets the user do
const CAPABILITY_TEXT = {
  'applications.view': 'View submitted applications',
  'applications.export': 'Export applications to CSV',
  'openings.view': 'View job openings',
  'openings.manage': 'Post and edit job openings',
  'branches.manage': 'Manage school branches',
  'entities.manage': 'Manage school groups (entities)',
  'users.manage': 'Create and manage users in your scope',
  'roles.manage': 'Manage roles and assign them to users',
};

function capabilityList(permissions = []) {
  if (permissions.includes('*')) {
    return ['Full access to everything - applications, openings, branches, entities, users and roles'];
  }
  return permissions.map((p) => CAPABILITY_TEXT[p]).filter(Boolean);
}

function welcomeHtml({ name, email, password, createdBy, roleName, capabilities, scopeText, appUrl }) {
  const capItems = capabilities
    .map(
      (c) => `
        <tr>
          <td style="padding:4px 0;font-size:14px;color:#4b5563;line-height:1.5;">
            <span style="color:${MAROON};font-weight:bold;">&#10003;&nbsp;&nbsp;</span>${c}
          </td>
        </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background-color:#f6f7f9;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f7f9;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,${NAVY} 0%,${NAVY_DARK} 100%);background-color:${NAVY};border-radius:16px 16px 0 0;padding:28px 36px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                ${
                  LOGOS.length
                    ? `<td style="background-color:#ffffff;border-radius:12px;padding:8px 14px;">
                        ${LOGOS.map(
                          (l, i) =>
                            `<img src="cid:${l.cid}" alt="${l.alt}" height="40" style="height:40px;vertical-align:middle;${i > 0 ? 'margin-left:12px;border-left:1px solid #e5e7eb;padding-left:12px;' : ''}" />`
                        ).join('')}
                      </td>
                      <td style="padding-left:18px;">`
                    : `<td>`
                }
                  <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Careers</p>
                  <p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.75);">Delhi Public Schools &amp; Pallavi Group of Schools</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background-color:#ffffff;padding:36px;border-left:1px solid #e8e4db;border-right:1px solid #e8e4db;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${MAROON};">Your account is ready</p>
            <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:${INK};letter-spacing:-0.01em;">Welcome aboard, ${name}</h1>

            <p style="margin:0 0 12px;font-size:14px;color:#4b5563;line-height:1.65;">
              This is the <strong>Careers Referral Portal</strong> for Delhi Public Schools and the Pallavi
              Group of Schools &mdash; where teachers share openings, candidates apply through referrals,
              and our team reviews every application in one place.
            </p>
            <p style="margin:0 0 24px;font-size:14px;color:#4b5563;line-height:1.65;">
              An account has been created for you by <strong style="color:${INK};">${createdBy}</strong>.
            </p>

            <!-- Credentials card -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f4ef;border:1px solid #e8e4db;border-radius:12px;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#a49e92;">Your login credentials</p>
                  <p style="margin:0 0 6px;font-size:14px;color:#4b5563;">Email:&nbsp;
                    <span style="font-family:Consolas,Menlo,monospace;font-size:14px;color:${INK};font-weight:600;">${email}</span>
                  </p>
                  <p style="margin:0 0 10px;font-size:14px;color:#4b5563;">Temporary password:&nbsp;
                    <span style="font-family:Consolas,Menlo,monospace;font-size:14px;color:${INK};font-weight:600;">${password}</span>
                  </p>
                  <p style="margin:0;font-size:12px;color:${MAROON};font-weight:600;">
                    You will be asked to choose your own password the first time you sign in.
                  </p>
                </td>
              </tr>
            </table>

            <!-- CTA -->
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0;">
              <tr>
                <td style="border-radius:999px;background-color:${MAROON};">
                  <a href="${appUrl}/admin" style="display:inline-block;padding:13px 34px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">
                    Open the Portal &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <!-- Access -->
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#a49e92;">Your access</p>
            <p style="margin:0 0 12px;font-size:14px;color:#4b5563;">
              Role: <strong style="color:${NAVY};">${roleName}</strong>
              &nbsp;&middot;&nbsp; Scope: <strong style="color:${NAVY};">${scopeText}</strong>
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              ${capItems}
            </table>

            <p style="margin:0;padding:14px 18px;background-color:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:13px;color:#92400e;line-height:1.6;">
              &#128274;&nbsp; For your security, please sign in and keep these credentials private.
              If you did not expect this email, contact your administrator.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background-color:#ffffff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 16px 16px;padding:20px 36px;">
            <p style="margin:0;font-size:11px;color:#a49e92;line-height:1.6;">
              This is an automated message from the Careers Referral Portal of
              Delhi Public Schools &amp; Pallavi Group of Schools. Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function welcomeText({ name, email, password, createdBy, roleName, capabilities, scopeText, appUrl }) {
  return [
    `Welcome aboard, ${name}!`,
    ``,
    `This is the Careers Referral Portal for Delhi Public Schools and the Pallavi Group of Schools.`,
    `An account has been created for you by ${createdBy}.`,
    ``,
    `Your login credentials:`,
    `  Email: ${email}`,
    `  Temporary password: ${password}`,
    ``,
    `You will be asked to choose your own password the first time you sign in.`,
    ``,
    `Portal: ${appUrl}/admin`,
    ``,
    `Role: ${roleName} | Scope: ${scopeText}`,
    `What you can do:`,
    ...capabilities.map((c) => `  - ${c}`),
    ``,
    `Please sign in and keep these credentials private.`,
  ].join('\n');
}

// Fire-and-forget friendly: resolves true when sent, false when skipped/failed.
async function sendWelcomeEmail({ to, name, password, createdBy, roleName, permissions, scopeText }) {
  if (!isConfigured()) {
    console.warn('Mail skipped (SMTP not configured): welcome email for', to);
    return false;
  }
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const capabilities = capabilityList(permissions);
  const payload = { name, email: to, password, createdBy, roleName, capabilities, scopeText, appUrl };

  try {
    await transporter().sendMail({
      from: process.env.MAIL_FROM || `"Careers Portal" <${process.env.SMTP_USER}>`,
      to,
      subject: 'Your Careers Portal account - Delhi Public Schools & Pallavi Group of Schools',
      text: welcomeText(payload),
      html: welcomeHtml(payload),
      attachments: LOGOS.map((l) => ({
        filename: l.file,
        path: path.join(LOGO_DIR, l.file),
        cid: l.cid,
      })),
    });
    return true;
  } catch (err) {
    console.error('Failed to send welcome email to', to, '-', err.message);
    return false;
  }
}

function exportOtpHtml({ code, requestedBy, requestedByEmail, scopeText, rowCount, minutes }) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background-color:#f6f7f9;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f7f9;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <tr>
          <td style="background:linear-gradient(135deg,${NAVY} 0%,${NAVY_DARK} 100%);background-color:${NAVY};border-radius:16px 16px 0 0;padding:28px 36px;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Careers</p>
            <p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.75);">Delhi Public Schools &amp; Pallavi Group of Schools</p>
          </td>
        </tr>

        <tr>
          <td style="background-color:#ffffff;padding:36px;border-left:1px solid #e8e4db;border-right:1px solid #e8e4db;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${MAROON};">Approval required</p>
            <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:${INK};letter-spacing:-0.01em;">Applications export requested</h1>

            <p style="margin:0 0 24px;font-size:14px;color:#4b5563;line-height:1.65;">
              <strong style="color:${INK};">${requestedBy}</strong> (${requestedByEmail}) is trying to download
              applicant data as a CSV file. Share the code below only if you approve this export.
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f4ef;border:1px solid #e8e4db;border-radius:12px;">
              <tr>
                <td align="center" style="padding:24px;">
                  <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#a49e92;">One-time code</p>
                  <p style="margin:0;font-family:Consolas,Menlo,monospace;font-size:38px;font-weight:700;letter-spacing:0.32em;color:${INK};">${code}</p>
                  <p style="margin:12px 0 0;font-size:12px;color:#6b7280;">Valid for ${minutes} minutes &middot; single use</p>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 6px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#a49e92;">What will be exported</p>
            <p style="margin:0 0 24px;font-size:14px;color:#4b5563;line-height:1.65;">
              ${rowCount} application${rowCount === 1 ? '' : 's'} &middot; ${scopeText}
            </p>

            <p style="margin:0;padding:14px 18px;background-color:#fef2f2;border:1px solid #fecaca;border-radius:10px;font-size:13px;color:#991b1b;line-height:1.6;">
              &#9888;&nbsp; This file contains candidates' personal contact details. If you did not expect this
              request, do not share the code and review the user's access.
            </p>
          </td>
        </tr>

        <tr>
          <td style="background-color:#ffffff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 16px 16px;padding:20px 36px;">
            <p style="margin:0;font-size:11px;color:#a49e92;line-height:1.6;">
              This is an automated message from the Careers Portal. Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Sends the export approval code to every super admin. Resolves to the list of
// recipients that were mailed (empty when SMTP is off or all sends failed).
async function sendExportOtpEmail({ recipients, code, requestedBy, requestedByEmail, scopeText, rowCount, minutes }) {
  if (!isConfigured()) {
    console.warn('Mail skipped (SMTP not configured): export OTP for', requestedByEmail);
    return [];
  }
  const payload = { code, requestedBy, requestedByEmail, scopeText, rowCount, minutes };
  const text = [
    `Applications export requested`,
    ``,
    `${requestedBy} (${requestedByEmail}) requested a CSV export of ${rowCount} application(s) - ${scopeText}.`,
    ``,
    `One-time code: ${code}`,
    `Valid for ${minutes} minutes, single use.`,
    ``,
    `Share this code only if you approve the export. It contains candidates' personal contact details.`,
  ].join('\n');

  const sent = [];
  for (const to of recipients) {
    try {
      await transporter().sendMail({
        from: process.env.MAIL_FROM || `"Careers Portal" <${process.env.SMTP_USER}>`,
        to,
        subject: `Approval code for applications export - requested by ${requestedBy}`,
        text,
        html: exportOtpHtml(payload),
      });
      sent.push(to);
    } catch (err) {
      console.error('Failed to send export OTP to', to, '-', err.message);
    }
  }
  return sent;
}

function passwordResetHtml({ name, code, minutes }) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background-color:#f6f7f9;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f7f9;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <tr>
          <td style="background:linear-gradient(135deg,${NAVY} 0%,${NAVY_DARK} 100%);background-color:${NAVY};border-radius:16px 16px 0 0;padding:28px 36px;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Careers</p>
            <p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.75);">Delhi Public Schools &amp; Pallavi Group of Schools</p>
          </td>
        </tr>

        <tr>
          <td style="background-color:#ffffff;padding:36px;border-left:1px solid #e8e4db;border-right:1px solid #e8e4db;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${MAROON};">Password reset</p>
            <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:${INK};letter-spacing:-0.01em;">Hello ${name},</h1>

            <p style="margin:0 0 24px;font-size:14px;color:#4b5563;line-height:1.65;">
              We received a request to reset the password for your Careers Portal account.
              Enter the code below on the reset screen to choose a new password.
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f4ef;border:1px solid #e8e4db;border-radius:12px;">
              <tr>
                <td align="center" style="padding:24px;">
                  <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#a49e92;">Your reset code</p>
                  <p style="margin:0;font-family:Consolas,Menlo,monospace;font-size:38px;font-weight:700;letter-spacing:0.32em;color:${INK};">${code}</p>
                  <p style="margin:12px 0 0;font-size:12px;color:#6b7280;">Valid for ${minutes} minutes &middot; single use</p>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0;padding:14px 18px;background-color:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:13px;color:#92400e;line-height:1.6;">
              &#128274;&nbsp; If you did not ask for this, you can ignore this email &mdash; your password
              stays unchanged. Never share this code with anyone.
            </p>
          </td>
        </tr>

        <tr>
          <td style="background-color:#ffffff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 16px 16px;padding:20px 36px;">
            <p style="margin:0;font-size:11px;color:#a49e92;line-height:1.6;">
              This is an automated message from the Careers Portal. Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Resolves true when the code was emailed, false when SMTP is off or failed
async function sendPasswordResetEmail({ to, name, code, minutes }) {
  if (!isConfigured()) {
    console.warn('Mail skipped (SMTP not configured): password reset code for', to);
    return false;
  }
  try {
    await transporter().sendMail({
      from: process.env.MAIL_FROM || `"Careers Portal" <${process.env.SMTP_USER}>`,
      to,
      subject: 'Your Careers Portal password reset code',
      text: [
        `Hello ${name},`,
        ``,
        `Use this code to reset your Careers Portal password: ${code}`,
        `It is valid for ${minutes} minutes and can be used once.`,
        ``,
        `If you did not ask for this, ignore this email - your password stays unchanged.`,
      ].join('\n'),
      html: passwordResetHtml({ name, code, minutes }),
    });
    return true;
  } catch (err) {
    console.error('Failed to send password reset email to', to, '-', err.message);
    return false;
  }
}

module.exports = {
  sendWelcomeEmail,
  sendExportOtpEmail,
  sendPasswordResetEmail,
  isConfigured,
  welcomeHtml,
  capabilityList,
};
