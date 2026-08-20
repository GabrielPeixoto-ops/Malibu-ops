# Malibu Ops — Project Handover

**Prepared:** August 19, 2026
**Prepared by:** Gabriel Peixoto
**Purpose:** Full technical and operational handover of the Malibu Ops system.

---

## 1. What This System Is

Malibu Ops is the internal web application used to run day-to-day operations: job scheduling, invoicing, payroll/commissions, fleet tracking, and (as of today) company-wide financial reporting. It replaced manual/spreadsheet tracking and is the single source of truth for job and billing data.

- **Live app:** malibu-ops.vercel.app (check the Vercel project for whether a custom domain has since been attached)
- **Code repository:** github.com/GabrielPeixoto-ops/Malibu-ops (private repo)
- **Hosting:** Vercel — auto-deploys every push to the main branch
- **Database:** Supabase (hosted Postgres + Auth), project ref ianqvenzoymjkjjrnzjy

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.9 (App Router), React 19.2.4, TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Database / Auth | Supabase (Postgres, Supabase Auth, PostgREST API) |
| Hosting / CI-CD | Vercel (auto-deploy on push to main) |
| Accounting integration | Xero (OAuth2, webhook sync) |
| Maps | Google Maps JavaScript API |
| Icons | lucide-react |

No automated test suite exists. Verification is manual: TypeScript compiler + ESLint locally, then a live click-through of the affected pages after deploy. Anyone continuing this project should budget time for manual QA after every change until tests are introduced.

---

## 3. How Deploys Work (important — read this first)

1. Application code lives in the GitHub repo. Pushing to main triggers an automatic Vercel build and deploy — no manual step needed on Vercel's side.
2. Database schema changes are separate and manual. They live as sequential SQL files in supabase/migration_v2.sql through supabase/migration_v61.sql (plus migration_v39_catchup.sql and a baseline schema.sql). None of these run automatically — each one must be pasted into the Supabase SQL Editor and executed by hand, in order.
3. This is a real risk. Because code and schema deploy through two independent channels, it is possible to ship code that references a database column before the migration that creates it has been run. This happened during today's work: the flag-related code went live referencing jobs.flagged before migration_v61.sql had been applied, which broke the Invoices page and would have blocked all job saves until the migration was run a few minutes later. The safe order is always: run the SQL migration first, then deploy code that depends on it.
4. There is no CLI or migration-runner tool wired up in this project — whoever takes over should consider adding one (e.g. Supabase CLI migrations) to remove this manual step and its risk.

---

## 4. Database Overview

Key tables:

- jobs — the central table. Every job has a source (private, subcontract, or contract), billing fields, crew assignments, and (new) flagged / flag_note / flagged_at.
- Crew/labor: job_crew, job_casual_crew, job_extra_men, job_commissions, job_employee_expenses
- Job detail: job_materials, job_expenses, job_trucks, job_addresses, job_comments, job_photos, job_rate_blocks
- Reference/master data: employees, casual_workers, subcontractors, subcontractor_rates, contracts, contract_rates, contract_clients, customers, private_rates, commission_types, fleet, fleet_fuel_logs
- Billing: invoices (formal subcontractor/B2B invoices, Xero-synced), invoice_reviews (payroll review workflow: reviewed to pending_approval to approved to paid)

Row-Level Security (RLS): every table is set up with FOR ALL ... USING (true) WITH CHECK (true) for both the anon and authenticated roles. In practice this means there is no real per-user access control at the database layer — anyone with the public anon key (which ships in the client-side JS bundle) can read and write any row. This was a deliberate simplification for an internal, trusted-network tool, but it's worth knowing plainly: Supabase Auth login gates the app's UI, not the database. If this app is ever exposed more broadly, this should be revisited before anything else.

A recurring gotcha: every new table needs both the anon and authenticated policies added explicitly, or it will silently be unreachable from the app (this caused a bug with job_employee_expenses earlier in the project).

---

## 5. Core Business Logic Conventions

These aren't obvious from reading any single file, so they're documented here:

- Revenue calculation (calcRevenue): each job source (private / subcontract / contract) has its own precedence rule for computing revenue from rate tables, contract rates, or manual overrides. The single most important override is the malibu_revenue column — if it's set on a job, it wins over everything else, regardless of source. This logic lives in src/lib/billing.ts and is also intentionally re-implemented (copy-pasted, not imported) inside Dashboard, Invoices, and Reporting.
- Why the duplication? This is a deliberate codebase convention, not an oversight: each page keeps its own self-contained copy of revenue/date-navigation logic so that a change on one page can never accidentally break another. The tradeoff is that a bug fix to the calculation must be applied in every copy — grep for calcRevenue / calcJobRevenue across src/app before considering any billing fix "done."
- Dual-reference pattern: tables like job_commissions and job_employee_expenses carry both an employee_id and a casual_worker_id column (only one populated per row) to represent "this could be a W-2 employee or a casual/day worker." Any query or form touching these tables needs to handle both.
- Payroll review workflow: invoice_reviews tracks each payroll period through reviewed to pending_approval to approved to paid. The full cost-calculation engine for this (calculatePayroll, buildStaffPayrollCrew, buildCasualPayroll, buildExtraMenPayroll, buildCommissionsForPayroll) lives in the Payroll/Invoices pages and was deliberately not duplicated into Reporting — Reporting shows payment/revenue status only, not full payroll cost breakdowns, to avoid calculation drift.

---

## 6. Full Feature / Page Inventory

| Route | Purpose |
|---|---|
| / | Dashboard — calendar view (day/week/month) of jobs |
| /jobs | Job list |
| /jobs/new, /jobs/[id]/edit | Job creation/edit form (JobForm.tsx, ~6,000 lines — most complex component in the app) |
| /invoices | Billing hub — tabs for Employees, Casuals, Commissions, Subcontractors, Contracts, Clients |
| /payroll | Payroll processing |
| /reporting | New (Aug 19, 2026) — company-wide financial/operational overview, see Section 7 |
| /weekly-recap | Weekly summary view |
| /teams | Weekly crew roster |
| /resources | Reference/resource material |
| /login | Auth |
| /settings/employees | Employee records |
| /settings/subcontractors | Subcontractor records + rates |
| /settings/contracts | Contract clients + rates |
| /settings/customers | Private customer records |
| /settings/fleet | Trucks |
| /settings/private-pricing | Private job rate tables |
| /settings/entity-colors | UI color coding per entity |
| /settings/commissions | Commission type definitions |
| /settings/xero | Xero integration connection/status |

---

## 7. Work Shipped Today (Aug 19, 2026)

Delivered per the owner's request for full operational visibility:

1. Job "Needs Attention" flag — any job can be flagged with a note (e.g. damage, dispute, follow-up needed). Shows as a red flag icon next to the job number on the Invoices page, and lists all flagged jobs with their notes on the new Reporting page. Editable even on "reviewed"/locked jobs. Migration: migration_v61.sql (adds jobs.flagged, jobs.flag_note, jobs.flagged_at) — confirmed run successfully.

2. New Reporting page (/reporting) — company-wide view with date/period navigation (day/week/range), showing:
   - KPIs: total jobs, revenue, paid vs. pending
      - Revenue broken down by source (private/subcontract/contract)
         - Job payment status: paid vs. pending, plus payment-method breakdown (cash/transfer/card)
            - Formal invoice status breakdown (draft/sent/paid)
               - Payroll review status breakdown (reviewed/pending_approval/approved/paid)
                  - Truck/diesel costs — total spend, average $/litre, and per-truck breakdown, sourced from fleet_fuel_logs
                     - Flagged jobs list, linking directly to the job for follow-up

                        This directly answers the owner's original ask: visibility into payment status (paid vs. pending), payment methods, per-truck spend with a diesel price baseline, and a way to flag jobs that need attention.

                        3. Verified live end-to-end after the migration was applied: correct job counts, revenue totals, payment breakdowns, and flagged-job display.

                        Known issue from today (resolved): the flag code was briefly deployed ahead of its migration, which temporarily broke the Invoices page and would have blocked all job saves. It was caught quickly, the migration was run, and full functionality was verified restored. No data was lost. This is flagged in Section 3 as a structural risk to manage going forward, not just a one-off incident.

                        ---

                        ## 8. Access & Credentials to Transfer

                        I do not have — and never had, in this working environment — direct credentials to these systems; all work was done through an already-authenticated browser session and environment variables configured by the owner. The following accounts/services need to be handed over through your own offboarding process (password manager transfer, re-invite, or credential rotation — whichever your process requires):

                        | Service | What to transfer | Notes |
                        |---|---|---|
                        | GitHub | Repo access to GabrielPeixoto-ops/Malibu-ops | Add new owner as collaborator or transfer repo ownership |
                        | Vercel | Project access/ownership | Controls deploys and environment variables |
                        | Supabase | Project membership for ianqvenzoymjkjjrnzjy | Controls the database, auth users, and SQL editor |
                        | Google Cloud | Maps JavaScript API key (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) | Used for address/mapping features |
                        | Xero | Developer app credentials (XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI, XERO_WEBHOOK_KEY) + the connected Xero organization | Powers the accounting sync |
                        | Domain/DNS (if applicable) | Any custom domain pointed at Vercel | Check Vercel project settings |

                        Environment variables in use (names only — values live in Vercel's project settings and the local .env.local/.env.production files, and should be rotated as part of any offboarding, not just copied):
                        NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI, XERO_ENCRYPTION_KEY, XERO_WEBHOOK_KEY, SUPABASE_SERVICE_ROLE_KEY.

                        Recommended standard practice for any departing developer: rotate the Supabase anon key, service role key, and Xero secrets after handover, since they may have been visible in local .env files, terminal history, or a password manager during development.

                        ---

                        ## 9. Recommended Next Steps for Whoever Takes This Over

                        1. Get added to GitHub, Vercel, and Supabase first — those three unlock everything else.
                        2. Do a full read-through of the supabase/ folder to understand schema history; consider setting up a proper migration tool (Supabase CLI) so schema changes stop being a manual, error-prone step.
                        3. Set up basic monitoring/alerts on Vercel (deploy failures) and Supabase (errors), since there's currently no automated testing to catch issues before they reach production.
                        4. Treat src/lib/billing.ts and its duplicated copies (grep calcRevenue) as the most business-critical, highest-risk code in the app — any change there touches real invoicing numbers.
                        5. Rotate all credentials listed in Section 8 once access has formally transferred.

                        ---

                        This document reflects the state of the system as of August 19, 2026. For the full change history, see git log in the repository and the sequential files in supabase/.
                        
