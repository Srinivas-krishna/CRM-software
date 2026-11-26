# ForgeFlow

A production workspace for an automotive parts manufacturer. Built with React, TypeScript, Express and PostgreSQL.

## Features

- Create and edit parts with a unique ID, customer company, desired quantity, approximate delivery date, production status, unit price and notes.
- Add multiple raw materials per part with supplier, required quantity, unit and supply status. Update each material's status from the part detail panel.
- Browse and search the parts table; select a part name to open its material and supplier table.
- See delivery alerts for parts due within seven days or overdue. Send an in-app alert, or email it when SMTP is configured. All sent alerts are saved in PostgreSQL.
- Create saved, numbered customer bills with a price and tax rate. Bills preserve a snapshot of part and customer details. Print or save a bill as PDF using the browser's print dialog.

## Run locally

Prerequisites: Node.js 20+ and PostgreSQL 14+ (or a hosted PostgreSQL database such as Neon).

1. Create a PostgreSQL database named `forgeflow` (or use an existing database).
2. Copy `.env.example` to `.env` and replace `DATABASE_URL` with your connection string. For a hosted database, include its required SSL parameters in the URL.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open `http://localhost:5173`. The API listens on `http://localhost:4000`.

The API creates its tables automatically on startup from `server/schema.sql`. No manual SQL import is needed. For a single server deployment, run `npm run build` followed by `npm start` and open port 4000. Configure the reverse proxy and `CORS_ORIGIN` for your deployment as needed.

## Email alerts

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and `ALERT_EMAIL` in `.env`. Set `SMTP_USER` and `SMTP_PASSWORD` if the mail server requires authentication. The email button sends to the configured production team address. In-app alerts work without SMTP. The delivery list highlights due dates automatically; sending an alert is a user action. There is no background email scheduler.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run API and frontend together |
| `npm run build` | Type-check and build the frontend |
| `npm test` | Run server validation tests |
| `npm start` | Serve the built app and API on port 4000 |

This is a single-workspace internal app with no user login or roles. Add authentication, authorization and backups before exposing it to an untrusted network.

## ERP masters and schedule vouchers

The application now opens in an ERP gateway without an account or sign-in requirement. Master data is stored separately from schedule transactions:

- Part master: part number, name, unit price (INR, two decimals).
- Customer master: customer ID, name, address.
- Raw material types: type, associated part numbers (one or more from Part master), and description.
- Supplier master: name, raw materials supplied (one or more from Raw material types), and address.
- Schedule vouchers: entry date, target date, part, quantity, customer, and a captured unit price.

Create parts before linking raw material types, then create suppliers. Create parts and customers before entering schedules. Master and voucher registers show oldest entries first in insertion order; editing a record retains its position. Master registers support creation, alteration and deletion; referenced masters cannot be deleted. Material and supplier links are displayed and searchable in their registers. Existing supplier links are preserved; use Alter to associate parts with existing raw materials. Voucher registers provide search, target month filtering, quantities and value totals. Vouchers are permanent entries in this version.

Run the database integration test with `ERP_DB_TEST=1 node --test server/erp.test.js` (PowerShell: `$env:ERP_DB_TEST='1'; node --test server/erp.test.js`). It uses the configured database and rolls back its test records.

`server/erp-schema.sql` is an additive, repeatable startup migration. Existing production orders, materials, invoices and alerts remain in their original tables, accessible through Production & billing; existing free-text orders are not automatically converted into masters or linked to schedule vouchers. Schedule vouchers are planning records and do not create production orders automatically.

`server/erp.js` owns the master and schedule API under `/api/erp`. Authentication is currently disabled; the app opens directly into the shared workspace. Existing user/session records are preserved but unused. Voucher creator attribution is optional.

Keyboard shortcuts: F2 gateway, F4 voucher register, Alt+N new entry, Esc close entry.

Schedule target dates accept a full calendar date. Existing month-only schedules retain the first day of their originally selected month. The register still supports filtering by target month.
