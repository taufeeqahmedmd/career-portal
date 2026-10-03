# Data API: connecting a reporting tool

This is the read-only feed that puts the careers portal's data into Power BI,
Excel, Google Sheets, Tableau, or any script. It returns every application with
its full hiring pipeline, plus the openings, branches, entities, staff and stage
configuration you need to report on it.

You need two things: the **base URL** and a **reporting API key**.

```
https://dpgos-careers.k-innovative.com/api/data
```

---

## 1. Getting a key

A reporting key is issued on the server by someone with shell access. It is a
different kind of key from the ones partner websites use to post applications:
a reporting key is read-only, and a partner key cannot read at all.

```bash
# On the production host
docker exec -it career-app-backend npm run api-key -- create --name "Power BI" --kind reporting

# Locked to one school group: the key sees only that entity's data
docker exec -it career-app-backend npm run api-key -- create --name "DPS dashboard" --kind reporting --entity DPS

# List and revoke
docker exec -it career-app-backend npm run api-key -- list
docker exec -it career-app-backend npm run api-key -- revoke --id 7
```

The key is printed **once**. Only a hash of it is stored, so if it is lost,
revoke it and issue a new one.

**This key reads every candidate's name, phone number, email, salary and
interview feedback** in its scope. Treat it like the password to the admin
panel:

- Keep it in the tool's credential store, never in a shared spreadsheet cell, a
  web page, or a public repository.
- Issue one key per tool or person, so one can be revoked without breaking the
  others.
- Use `--entity` when a dashboard is only for one school group.
- Every read is written to the server log with the key's name and row count.

---

## 2. Requests

Send the key in a header on every request:

```
X-API-Key: ck_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`Authorization: Bearer ck_live_…` works too. Keys are not accepted in the URL,
because URLs end up in logs and browser history.

| Request | Returns |
| --- | --- |
| `GET /api/data` | Every dataset in one JSON document |
| `GET /api/data/{dataset}` | One dataset as a JSON array |
| `GET /api/data/{dataset}?format=csv` | One dataset as a CSV file |

Optional parameters on any request:

| Parameter | Meaning |
| --- | --- |
| `from=YYYY-MM-DD` | Only applications submitted on or after this day |
| `to=YYYY-MM-DD` | Only applications submitted on or before this day |
| `format=json` or `csv` | Default `json`. CSV is one table per file, so it only works with a dataset name |

`from` and `to` count days in the portal's timezone (Asia/Kolkata). They select
**applications**; `interview_rounds` and `activity` follow their application, so
the three tables always describe the same candidates. The other datasets are
reference data and ignore the window.

There is no paging. Each response holds the whole table, streamed from the
database, however large it is.

**The API is read-only.** Nothing sent to it can change the portal's data:

- Only `GET` is accepted. `POST`, `PUT`, `PATCH` and `DELETE` are refused with
  `405` before the key is even checked.
- A reporting key is refused by the one public endpoint that writes
  (`POST /api/applications`), so it cannot be used to file applications either.
- Every query runs in a read-only database transaction, so PostgreSQL itself
  would reject a write.

### `GET /api/data`

```json
{
  "generated_at": "2026-10-03T06:30:00.000Z",
  "timezone": "Asia/Kolkata",
  "entity": null,
  "from": null,
  "to": null,
  "datasets": ["applications", "interview_rounds", "activity", "openings",
               "branches", "entities", "users", "flow_options"],
  "applications": [ { "id": 1, "full_name": "…", … }, … ],
  "interview_rounds": [ … ],
  …
}
```

Everything in one response is read from a single database snapshot, so the
tables agree with each other: no round points at an application that is not in
the file. `entity` is the school group the key is locked to, or `null` for all.

---

## 3. Datasets

Every dataset is a flat table. Column names are the same in JSON and CSV.
Timestamps are UTC (ISO 8601); columns ending in `_date` are calendar days in
the portal's timezone, which is what you want for "applications per day".

### How the tables join

```
applications.id           ─┬─ interview_rounds.application_id
                           └─ activity.application_id
applications.opening_id   ─── openings.id
applications.entity       ─── entities.code     (also openings.entity, branches.entity, users.entity)
applications.stage_key    ─── flow_options.key  where flow_options.type = 'profile_stage'
interview_rounds.status_key ─ flow_options.key  where flow_options.type = 'profile_stage'
activity.actor_user_id    ─── users.id
```

### `applications`: one row per application

| Column | Meaning |
| --- | --- |
| `id` | Application id |
| `submitted_at`, `submitted_date` | When it arrived (UTC timestamp / local day) |
| `last_activity_at` | Last pipeline update; empty if nobody has touched it |
| `full_name`, `email`, `mobile` | The applicant |
| `opening_id`, `position`, `branch`, `entity` | What they applied for. Copied at submission, so they survive later edits to the opening |
| `category`, `curriculum` | From the opening: Academic / Non-Academic; CBSE / CIE |
| `experience_years`, `current_company`, `qualification` | As entered on the form. `qualification` is only filled on legacy records |
| `stage_key`, `stage` | Pipeline stage: key (`new`, `shortlisted`, …) and its label |
| `screening_experience`, `screening_current_salary`, `screening_expected_salary`, `screening_location`, `screening_comments` | Screening notes |
| `willing_to_relocate` | `true` / `false` |
| `next_round_after_screening` | Screening answered "next interview round: yes" |
| `interview_rounds` | Number of rounds opened |
| `reached_interview` | At least one round was actually held. Matches the dashboard's "in interview" count |
| `latest_round_status`, `latest_round_assignee` | The most recent round |
| `suggested_role` | Alternative role suggested by HR |
| `referred_entity`, `referred_branch` | Handed over to another branch; empty if not |
| `is_employee_referral` | An employee referred this applicant |
| `referral_employee_code`, `referral_employee_name`, `referral_employee_contact`, `referral_employee_department` | The referring employee |
| `source` | Readable traffic source: Website, Google Ads, Meta Ads, a partner site's name, … |
| `submitted_via` | `Careers portal`, or the partner website that posted it |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`, `fbclid` | Raw campaign tags |
| `tracking_params` | JSON text: landing page, referrer, any other query parameters |
| `resume_link` | Where the resume is stored. Drive files are private; staff open resumes from the admin panel |

### `interview_rounds`: one row per round

`id`, `application_id`, `round_no`, `status_key`, `status` (label), `took_place`
(feedback or an outcome was recorded), `feedback`, `assigned_to` (name),
`assigned_to_user_id`, `next_round` (answered "next round: yes"), `updated_by`
(name), `updated_by_user_id`, `created_at`, `updated_at`.

### `activity`: the timeline of every application

`id`, `application_id`, `action` (`submitted`, `screening`, `round`,
`suggestion`), `detail`, `actor` (staff name; `null` on the `submitted` row,
which the applicant created), `actor_user_id`, `created_at`, `created_date`.

Use it for "who did what" and for time-in-stage reports.

### `openings`

`id`, `position`, `branch`, `entity`, `category`, `curriculum`, `eligibility`,
`is_active`, `applications` (all-time count; ignores `from`/`to`), `created_by`,
`created_by_user_id`, `created_at`, `updated_at`.

### `branches`

`id`, `name`, `entity`, `is_active`, `created_at`.

### `entities`: school groups

`id`, `code`, `name`, `color`, `is_active`, `created_at`.

### `users`: admin panel accounts

`id`, `name`, `email`, `role`, `entity`, `branch`, `is_active`,
`last_login_at`, `created_at`. Passwords and two-factor details are never
included. An entity-locked key sees only that entity's staff.

### `flow_options`: pipeline configuration

`id`, `type` (`profile_stage`, `assignee`, `suggested_role`), `key`, `label`,
`color`, `category`, `sort_order`, `is_system`, `is_active`.

Sort stage visuals by `sort_order` from the `profile_stage` rows so they read in
pipeline order, and use `color` to match the admin panel.

### What an entity-locked key sees

The same data an entity admin sees in the panel: applications for that entity's
openings **plus** applicants handed over to one of its branches, their rounds
and activity, and that entity's openings, branches, staff and its own entity
row. `flow_options` is shared configuration and is always complete.

---

## 4. Connecting tools

### Power BI Desktop / Excel (Power Query)

CSV is the most direct route: each dataset arrives as a ready table with its
headers. Create one query per dataset (**Get Data → Blank Query → Advanced
Editor**):

```powerquery
let
    Key    = "ck_live_…",
    Source = Csv.Document(
        Web.Contents(
            "https://dpgos-careers.k-innovative.com/api/data/",
            [
                RelativePath = "applications",
                Query        = [format = "csv"],
                Headers      = [#"X-API-Key" = Key]
            ]
        ),
        [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]
    ),
    Table  = Table.PromoteHeaders(Source, [PromoteAllScalars = true])
in
    Table
```

Change `RelativePath` for the other datasets. Add `from` / `to` to `Query` to
limit the window.

Keeping the base URL fixed and passing the dataset as `RelativePath` is what
lets the **Power BI service** refresh it on a schedule. In the service, set the
data source's authentication to **Anonymous** (the key travels in the header)
and turn on **Skip test connection**.

Without the editor: **Get Data → Web → Advanced**, URL
`https://dpgos-careers.k-innovative.com/api/data/applications?format=csv`, and
add a header `X-API-Key` with the key.

Then define the relationships from section 3 in the model view.

### Google Sheets (Apps Script)

`IMPORTDATA` cannot send a header, so use a small script: **Extensions → Apps
Script**, paste this, save the key under **Project Settings → Script
properties** as `CAREERS_DATA_KEY`, and add a time-driven trigger on
`refreshAll` to keep it current.

```js
const BASE = 'https://dpgos-careers.k-innovative.com/api/data/';
const DATASETS = ['applications', 'interview_rounds', 'openings', 'branches'];

function refreshAll() {
  const key = PropertiesService.getScriptProperties().getProperty('CAREERS_DATA_KEY');
  const book = SpreadsheetApp.getActive();
  for (const name of DATASETS) {
    const res = UrlFetchApp.fetch(`${BASE}${name}?format=csv`, {
      headers: { 'X-API-Key': key },
    });
    const text = res.getContentText('UTF-8').replace(/^﻿/, '');
    const rows = Utilities.parseCsv(text);
    const sheet = book.getSheetByName(name) || book.insertSheet(name);
    sheet.clearContents();
    sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  }
}
```

Anyone the spreadsheet is shared with can read the candidate data in it. Share
it accordingly.

### Python / pandas

```python
import io
import requests
import pandas as pd

BASE = "https://dpgos-careers.k-innovative.com/api/data"
HEADERS = {"X-API-Key": "ck_live_…"}

# Everything at once
data = requests.get(BASE, headers=HEADERS, timeout=300).json()
applications = pd.DataFrame(data["applications"])
rounds = pd.DataFrame(data["interview_rounds"])

# Or one table as CSV
r = requests.get(f"{BASE}/applications", params={"format": "csv"}, headers=HEADERS, timeout=300)
r.raise_for_status()
df = pd.read_csv(io.StringIO(r.content.decode("utf-8-sig")))
```

### Tableau, Metabase, others

Anything that can fetch a URL with a custom header works: point it at a CSV
dataset URL. For tools that cannot send headers at all, run a small scheduled
script (like the Python one above) that writes the files somewhere the tool can
read.

### curl

```bash
KEY="ck_live_…"
curl -H "X-API-Key: $KEY" https://dpgos-careers.k-innovative.com/api/data/entities
curl -H "X-API-Key: $KEY" -o applications.csv "https://dpgos-careers.k-innovative.com/api/data/applications?format=csv"
curl -H "X-API-Key: $KEY" "https://dpgos-careers.k-innovative.com/api/data?from=2026-09-01&to=2026-09-30" > september.json
```

---

## 5. Details worth knowing

**CSV and spreadsheet formulas.** A text cell that starts with `=`, `+`, `-` or
`@` is prefixed with `'` in CSV, so that opening the file in Excel cannot run a
formula an applicant typed into a form. JSON returns values untouched. If exact
text matters for such values, use JSON.

**CSV encoding.** UTF-8 with a byte-order mark, so Excel shows non-English names
correctly. Most tools strip the mark; if the first column header reads
`ï»¿id` or `﻿id`, decode as `utf-8-sig`.

**Empty values.** Text fields the applicant or staff left blank are empty
strings; things that do not exist (no rounds yet, no actor) are `null` in JSON
and empty in CSV.

**Freshness.** Every request reads live data. Nothing is cached.

**Rate limit.** Each key has its own hourly allowance (120 requests by default,
set with `--limit` when the key is issued). A scheduled refresh of all eight
datasets every hour uses 8.

---

## 6. Errors

Errors are JSON in the same shape as the rest of the public API:

```json
{
  "success": false,
  "error": "Send your reporting API key in the X-API-Key header.",
  "errors": [{ "field": "api_key", "code": "unauthorized", "message": "…" }]
}
```

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid` | A bad `from` / `to` / `format`; `field` says which |
| 401 | `unauthorized` | No key, an unknown key, or a revoked key |
| 403 | `forbidden` | A partner-site key (it cannot read data), or the key's school group has been deactivated |
| 404 | `not_found` | No such dataset; the message lists the valid names |
| 405 | `method_not_allowed` | Anything other than `GET`: the API is read-only |
| 429 | `rate_limited` | The key's hourly allowance is used up |

If the server hits an error part-way through a download, it cuts the
connection instead of closing the file normally. Your tool reports a failed
refresh rather than loading a partial table that looks complete.
