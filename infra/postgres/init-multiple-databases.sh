#!/usr/bin/env bash
set -Eeuo pipefail

# PostgreSQL executes this only when its data directory is first initialized.
readonly DATABASES=(auth_db employee_db attendance_db payroll_db)

for database in "${DATABASES[@]}"; do
  echo "Creating database ${database} when it does not already exist"
  psql --username "${POSTGRES_USER}" --dbname postgres --set=ON_ERROR_STOP=1 --set=database="${database}" <<'SQL'
SELECT format('CREATE DATABASE %I', :'database')
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = :'database'
)
\gexec
SQL
done

# Employee Service uses ltree materialized paths for efficient descendant queries.
psql --username "${POSTGRES_USER}" --dbname employee_db --set=ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS ltree;
SQL
