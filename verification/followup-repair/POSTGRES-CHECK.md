# Followup PostgreSQL regression check

Result: **5 tests passed** with PostgreSQL 18.3 compiled to WebAssembly by PGlite 0.5.8. See `postgres-integration.txt`.

The check runs the production authentication/API handlers and PostgreSQL SQL adapter against an isolated in-memory engine. It verifies first-entry customer counts and immediate selected-customer results for both staff roles, merchant isolation, account switching, legacy ownership payloads, filtered pagination, and current parcel ownership/deletion. No production database is read or changed. The Render network and node-postgres wire protocol are not covered.

From the website source root, with its normal dependencies already installed:

```bash
PG_TEST_DIR=$(mktemp -d)
npm install --prefix "$PG_TEST_DIR" --no-package-lock --ignore-scripts @electric-sql/pglite@0.5.8
ALMADINA_TEST_PGLITE_MODULE="$PG_TEST_DIR/node_modules/@electric-sql/pglite/dist/index.js" node --test tests/followups-postgres.integration.mjs
```

PGlite is an optional test dependency installed outside the project. It is not added to the application package or deployment. Without `ALMADINA_TEST_PGLITE_MODULE`, the integration test explicitly reports **SKIP**.
