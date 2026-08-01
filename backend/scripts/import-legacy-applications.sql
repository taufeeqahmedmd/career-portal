-- One-off import of the 30 applications received before this portal replaced
-- the previous deployment.
--
-- Those applications predate the resume upload, the email field and the
-- screening pipeline, so only the columns that existed then are populated:
-- name, mobile, position, branch, entity, referral details and the original
-- submission time. Everything else is left at its default, which is the
-- accurate record - not missing data.
--
-- Safe to run more than once: the unique index on (opening_id, mobile) plus
-- ON CONFLICT DO NOTHING means a second run inserts nothing.
--
-- Openings must already exist on this server; each row is re-linked by
-- position + branch + entity, because opening ids differ between servers.
--
--   docker exec -i career-app-postgres psql -U careers -d careers \
--     < backend/scripts/import-legacy-applications.sql
--
BEGIN;

WITH incoming (full_name, mobile, position, branch, entity,
               ref_code, ref_name, ref_contact, ref_branch, submitted_at) AS (
  VALUES
  ('GOUSIA KHATOON', '9963181459', 'PGT - (Primary ,  Lower Secondary & AS/ A Levels)', 'DPS Nacharam', 'DPS', 'NGAD0096', 'Mohammed Arif Baba', '9014973567', 'NADERGUL/IT', '2026-08-01 08:31:54'),
  ('Rohini G', '9063844218', 'EA to Director and Principal', 'Pallavi International School, Sagar Road', 'Pallavi', '1208', 'D Santhoshi', '8886703234', 'DPS Nacharam', '2026-08-01 06:20:11'),
  ('Deepthi', '9100322632', 'Primary Assistant Teacher', 'Pallavi International School, Sagar Road', 'Pallavi', 'NHAD0328', 'Snehamayee', '9652690270', 'DPS NACHARAM', '2026-08-01 05:10:56'),
  ('Deepthi', '9100322632', 'Pre - Primary Assistant Teacher', 'Pallavi International School, Sagar Road', 'Pallavi', 'NHAD0328', 'Snehamayee', '9652690270', 'DPS NACHARAM', '2026-08-01 05:10:20'),
  ('RAJENLIU GANGMEI', '8159929522', 'Pre - Primary Teacher', 'Pallavi International School, Thumukunta', 'Pallavi', 'KIAD0037', 'Lantilung Gangmei', '7338505001', 'K-INNOVATIVE', '2026-08-01 04:36:08'),
  ('RAJENLIU GANGMEI', '8159929522', 'Pre - Primary Assistant Teacher', 'Pallavi International School, Sagar Road', 'Pallavi', 'KIAD0037', 'Lantilung Gangmei', '7338505001', 'K-INNOVATIVE', '2026-08-01 04:30:59'),
  ('BANGARI SRAVAN KUMAR', '8142530588', 'PGT - (Primary ,  Lower Secondary & AS/ A Levels)', 'DPS Nacharam', 'DPS', 'NHAD0496', 'RAJMANOHAR KALUWALA', '9491475026', 'Nacharam / Marketing', '2026-08-01 04:30:41'),
  ('Luphunliu Gonmei', '8414826827', 'Residential Nurse', 'DPS Nacharam', 'DPS', 'KIAD0037', 'Lantilung Gangmei', '7338505001', 'K-INNOVATIVE', '2026-08-01 03:55:35'),
  ('Srinija Lingala', '8523080826', 'HR Executive', 'DPS Nadergul', 'DPS', 'KIAD10196', 'Shivani', '9731561919', 'Nadergul', '2026-08-01 01:42:28'),
  ('Venkata Raghavan', '9701201023', 'PGT - Physics', 'Pallavi International School, Gandipet', 'Pallavi', 'NGTR0415', 'Vanam Renuka', '7032162235', 'Dps Nadergul', '2026-07-31 17:40:05'),
  ('Venkata Raghavan', '9701201023', 'PGT - Chemistry', 'Pallavi International School, Gandipet', 'Pallavi', 'NGTR0415', 'Vanam Renuka', '7032162235', 'Dps Nadergul', '2026-07-31 17:38:44'),
  ('M.Anusha', '8008848118', 'PGT - Physics', 'Pallavi International School, Gandipet', 'Pallavi', 'MHTR0050', 'Ch.Kavita Rai', '9849165554', 'Mahendra Hills', '2026-07-31 15:09:17'),
  ('Hasmitha Nyshadham', '9568538337', 'HR Executive', 'DPS Nadergul', 'DPS', 'NHTR0262', 'Rajyalakshmi Abburi', '8497984079', 'DPS Nacharam', '2026-07-31 14:15:08'),
  ('Rachel Gangmei', '8519976278', 'HR Executive', 'DPS Nadergul', 'DPS', 'KIAD0037', 'Lantilung Gangmei', '7338505001', 'Company: K-Innovative Hub Pvt.Ltd', '2026-07-31 12:42:51'),
  ('Damanapeta Nikhila', '7660822533', 'PGT - (Primary ,  Lower Secondary & AS/ A Levels)', 'DPS Nacharam', 'DPS', 'NGTR0398', 'D.shalini', '7660822533', 'DPS Nadergul', '2026-07-31 12:21:39'),
  ('BONATH SAIDULU', '9494247917', 'TGT - Maths', 'DPS Aerocity', 'DPS', 'MHTR0050', 'Ch.Kavita Rao', '9849165554', 'Mahendra Hills', '2026-07-31 12:20:17'),
  ('Sachin Kaushal', '9161209098', 'TGT - Computer', 'Pallavi International School, Thumukunta', 'Pallavi', 'NGTR0670', 'Urmi Paul', '8910987087', 'Nadergul/ French', '2026-07-31 11:45:04'),
  ('PERUMALLA RAJA KIRTHI SAMUEL', '9052023953', 'HR Executive', 'DPS Nadergul', 'DPS', 'KIAD0176', 'M JAYANTH KUMAR', '9347757831', '', '2026-07-31 10:17:10'),
  ('Kishore Bhawarkar', '7620975779', 'HR Executive', 'DPS Nadergul', 'DPS', 'NHTR0873', 'Neha Nasir Khan', '9158761280', 'DPS NACHARAM', '2026-07-31 09:52:06'),
  ('Mamatha R', '8897375469', 'Pre - Primary Assistant Teacher', 'Pallavi International School, Sagar Road', 'Pallavi', 'NHAD0328', 'Snehamayee', '9652690270', 'DPS NACHARAM', '2026-07-31 09:24:58'),
  ('Yotindra mandal', '7595812073', 'Cricket Coach', 'Pallavi International School, Sagar Road', 'Pallavi', 'Mhtr0161', 'Bhagavathi Lakshmi Krishna Gayathri', '8309815525', 'Dps mahendra hills', '2026-07-31 08:25:01'),
  ('Sri shanthi', '9866336212', 'PGT - Physics', 'Pallavi International School, Gandipet', 'Pallavi', 'GPTR0313', 'P S N SREE LATHA', '8106224204', 'Gandipet, Telugu', '2026-07-31 07:32:36'),
  ('Rajeev Manoharan', '8526362870', 'PGT - English', 'Pallavi International School, Gandipet', 'Pallavi', 'GPTR0313', 'P S N SREE LATHA', '8106224204', 'Gandipet, Telugu', '2026-07-31 07:09:22'),
  ('Jagadeeah puppala', '9908854313', 'PGT - Physics', 'Pallavi International School, Gandipet', 'Pallavi', 'GPTR0313', 'P S N SREE LATHA', '8106224204', 'Gandipet, Telugu', '2026-07-31 07:06:16'),
  ('Dr. Mujeeb Ayoob', '7006838004', 'Principal', 'DPS Nacharam', 'DPS', 'NHAD0496', 'RAJMANOHAR KALUWALA', '9491475026', 'MARKETING', '2026-07-31 06:48:38'),
  ('PATLA. VINOD REDDY', '8106019065', 'HM (Grade 5 & 6)', 'DPS Nacharam', 'DPS', 'BWTR0265', 'C. BHAGYALAXMI', '9704359065', 'PALLAVI MODEL SCHOOL BOWENPALLY TELUGU', '2026-07-31 06:36:58'),
  ('PATLA. VINOD REDDY', '8106019066', 'Principal', 'DPS Nacharam', 'DPS', 'BWTR0265', 'C. BHAGYALAXMI', '9704359065', 'PALLAVI MODEL SCHOOL BOWENPALLY TELUGU', '2026-07-31 06:35:26'),
  ('Vanita jain', '8885304040', 'HM (Grade 5 & 6)', 'DPS Nacharam', 'DPS', 'Nhad0047', 'Vanita jain', '8885304040', 'Nacharam', '2026-07-31 06:17:52'),
  ('Venkey', '9912663554', 'Cricket Coach', 'Pallavi International School, Sagar Road', 'Pallavi', 'GPTR0313', 'P S N SREE LATHA', '8106224204', 'Gandipet, Telugu', '2026-07-31 06:07:51'),
  ('Naaz Zynab', '7032680159', 'Special Educator', 'DPS Aerocity', 'DPS', 'SNAD0156', 'Chukka Nidhi', '9989859819', 'Pallavi saroor Nagar', '2026-07-31 05:36:36')),
inserted AS (
  INSERT INTO applications (
    full_name, mobile, email, qualification, opening_id, position, branch, school_group,
    referral_employee_code, referral_employee_name, referral_employee_contact,
    referral_employee_branch, experience_years, current_company,
    resume_link, resume_file_id, source, screening_status, created_at)
  SELECT i.full_name, i.mobile, '', '', o.id, i.position, i.branch, i.entity,
         i.ref_code, i.ref_name, i.ref_contact, i.ref_branch, '', '',
         '', '', 'Website', 'new', i.submitted_at::timestamptz
  FROM incoming i
  -- Re-link to THIS server's openings; a row whose position/branch is missing
  -- is skipped rather than orphaned
  JOIN openings o
    ON o.school_group  = i.entity
   AND lower(o.branch) = lower(i.branch)
   AND lower(o.position) = lower(i.position)
  ON CONFLICT DO NOTHING
  RETURNING id, position, branch, created_at
)
INSERT INTO application_activity (application_id, action, detail, created_at)
SELECT id, 'submitted', position || ' - ' || branch || ' · via Website', created_at
FROM inserted;

COMMIT;
