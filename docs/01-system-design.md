# Employee Management System — System Design

> Status: **Design (Deliverable 1 & 2)**. Code scaffolding follows after this is reviewed.
> Read alongside the chat notes; this doc is the canonical reference.

---

## 1. Architecture overview

Six independently deployable services behind an API Gateway, communicating
asynchronously through a message broker. Each service owns its own datastore
(database-per-service) to enforce strong boundary contracts.

```
                        ┌────────────────────┐
   clients ──── HTTPS ─▶│   API Gateway      │  (auth verify, rate limit,
                        │  (NestJS custom)   │   circuit break, trace origin)
                        └─────────┬──────────┘
            ┌──────────┬──────────┼───────────┬───────────┐
            ▼          ▼          ▼           ▼           ▼
        ┌──────┐  ┌──────────┐ ┌─────────┐ ┌────────┐ ┌────────────┐
        │ Auth │  │ Employee │ │Attendce │ │Payroll │ │Notification│
        │  Svc │  │   Svc    │ │   Svc   │ │  Svc   │ │    Svc     │
        └──┬───┘  └────┬─────┘ └────┬────┘ └───┬────┘ └─────┬──────┘
           │PG         │PG          │PG         │PG          │Mongo
           └───────────┴────────────┴───────────┴────────────┘
                              publish / subscribe
                                       │
                              ┌────────▼─────────┐
                              │   RabbitMQ       │  topic exchanges
                              │  + DLX/DLQ       │  + dead-letter queues
                              └────────┬─────────┘
                                       │
                              ┌────────▼─────────┐
                              │   Redis          │  sessions, rate-limit
                              │                  │  counters, caches, CB state
                              └──────────────────┘
```

**Why microservices here (the question you'll be asked):** Not because "microservices
are better" — they're not, for a small team building a simple CRUD app. They earn
their cost here because the sub-domains have *different*:

- **Scaling profiles** — Attendance clock-in is bursty/high-write at shift changes;
  Payroll is a batch job once a month; Notification is fan-out heavy.
- **Consistency models** — Payroll must be strictly consistent & idempotent (money);
  Notification can be eventually consistent and best-effort.
- **Compliance boundaries** — Auth holds credentials (security audit); HR data in
  Employee (PII handling); Payroll (financial records). Different audit regimes.
- **Failure isolation requirements** — Notification being down must *not* block a
  leave approval. Async decoupling delivers that guarantee.

If this were an internal tool for 50 people with flat requirements, a modular
monolith would win. We pick microservices specifically to *demonstrate* the
distributed-systems properties this system is being built to showcase
(idempotency, eventual consistency, circuit breaking, DLQs).

---

## 2. Service boundaries

| Service | Owns (data + behavior) | Does NOT own | Datastore |
|---|---|---|---|
| **Auth** | users, credentials, roles, refresh tokens, login rate-limiting | employee profile, salary | PostgreSQL (+ Redis) |
| **Employee** | employee profiles, departments, org hierarchy | auth state, attendance | PostgreSQL |
| **Attendance** | leave requests, leave state machine, leave balances (authoritative), clock events | salary calc, payslips | PostgreSQL |
| **Payroll** | salary config, pay runs, payslips, idempotent pay processing | leave-of-record truth | PostgreSQL |
| **Notification** | notification log, delivery attempts, WebSocket sessions | business state | MongoDB |
| **Gateway** | routing, auth verification, rate limiting, edge circuit breakers | any business data | Redis (counters) |

### Boundary-defense notes (interview talking points)

- **Why is Auth separate from Employee?** Credentials & token-signing are the
  highest-trust surface. A Payroll SQL-injection must not expose password hashes.
  Centralizing RBAC also gives one revocation/rotation point. Trade-off: a
  request needs identity (Auth/JWT) *and* profile (Employee); we pay one extra
  call/Gateway-enrichment rather than denormalizing.
- **Why is the leave *balance* owned by Attendance but *cached* in Payroll?**
  Attendance is the system of record for leave. Payroll consumes
  `attendance.leave.transitioned` and keeps a **projection** for fast pay calc,
  explicitly treated as *eventually consistent*. This is the canonical
  CQRS/projection pattern and is exactly where we demonstrate eventual
  consistency on the frontend.
- **Why is Notification a pure consumer?** So it can fail without breaking core
  flows. It binds to the same events everything else does and never sits on the
  synchronous request path. This is our graceful-degradation story.
- **Why a custom Gateway and not Kong?** Kong is ops-heavy (DB, declarative
  config, plugins) and hides the logic we *want* to show (auth verify, rate
  limit, circuit breaker). A thin NestJS gateway makes those mechanisms
  auditable in code. In production at higher scale we'd revisit Kong/Tyk.

---

## 3. Event schema (the most important decision)

### 3.1 Envelope contract (every event, no exceptions)

```jsonc
{
  "eventId":        "8f1c...-uuid",     // consumer-side idempotency dedupe key
  "eventType":      "attendance.leave.transitioned",
  "eventVersion":   1,                  // schema evolution; consumers version-switch
  "occurredAt":     "2026-07-18T09:12:00Z",
  "producer":       "attendance-service",
  "traceId":        "a3b...trace",      // OpenTelemetry trace, propagated end-to-end
  "correlationId":  "cmd-...-user-action", // ties back to the originating request
  "causationId":    null,                // optional: event that caused this one
  "payload":        { /* event-specific, see catalog */ }
}
```

**Design rules (and why they matter):**

1. **`eventId` is the idempotency key for consumers.** The broker is *at-least-once*.
   Consumers `INSERT INTO processed_events(eventId)`; on a unique-violation they
   skip. This is how we turn at-least-once into effectively-once.
2. **`eventVersion` for schema evolution.** Payroll must keep working when
   Attendance ships v2 of `leave.transitioned`. Consumers switch on version.
3. **`traceId` rides in the envelope *and* in HTTP headers** (`traceparent` /
   `x-trace-id`) so logs across all services join into one trace.
4. **Events describe facts in the past tense** (`LeaveRequested`, not
   `RequestLeave`) — they are immutable records of something that happened.
5. **Publishing is transactional with the write (outbox pattern).** We write the
   domain row *and* an `outbox` row in the same DB transaction; a relay publishes
   to the broker. This avoids the "committed but never published" dual-write bug.

### 3.2 Event catalog

| Routing key | Producer → Consumers | Purpose |
|---|---|---|
| `auth.user.registered` | Auth → Employee, Notification | new identity created; Employee links profile |
| `employee.created` / `.updated` | Employee → Attendance, Payroll, Notification | profile change; manager re-resolution; pay-config provisioning |
| `employee.manager_changed` | Employee → Attendance | re-route pending leave approval chains |
| `attendance.leave.requested` | Attendance → Notification | notify manager to review |
| `attendance.leave.transitioned` | Attendance → Notification, Payroll | the core workflow event (see below) |
| `attendance.clock.recorded` | Attendance → Payroll | hourly/attendance-derived pay |
| `payroll.payrun.started` / `.completed` | Payroll → Notification | pay-run lifecycle |
| `payroll.payslip.generated` | Payroll → Notification | "your payslip is ready" |
| `notification.delivery.failed` | Notification → DLX | routed to dead-letter queue |

### 3.3 The workflow event (the spine of the system)

A single rich event carries every leave state transition; consumers filter on
`toState`. The routing key is *specialized* per transition (`...approved`,
`...rejected`) so consumers can bind narrowly without us multiplying schemas:

```jsonc
{
  "eventId": "...",
  "eventType": "attendance.leave.transitioned",
  "eventVersion": 1,
  "traceId": "...",
  "payload": {
    "leaveRequestId": "lr-123",
    "employeeId": "emp-42",
    "leaveType": "VACATION",
    "startDate": "2026-08-10",
    "endDate": "2026-08-14",
    "totalDays": 5,
    "fromState": "MANAGER_REVIEW",
    "toState": "APPROVED",
    "actorId": "usr-mgr-7",
    "reason": "Plan approved, coverage arranged",
    "occurredAt": "2026-07-18T09:12:00Z"
  }
}
```

- **Notification** binds to `attendance.leave.*` → sends an email/WS push for every
  transition the recipient cares about.
- **Payroll** binds to `attendance.leave.approved` → updates its
  `leave_balance_projection` (deducting unpaid-leave days for the period). It
  ignores `requested`/`rejected`.
- Frontend reads `toState` for optimistic UI and reconciles against Payroll's
  projection (see §5).

**Why one transitioned-event instead of `LeaveManagerApproved`, `LeaveHRApproved`,
... ?** Fewer schemas to version, adding a state (e.g. `FINANCE_REVIEW`) doesn't
break consumers that filter by `toState`. Trade-off: consumers do a tiny bit more
filtering — acceptable.

---

## 4. Database schemas (deliverable 2)

Polyglot: PostgreSQL for the relational/transactional core (Auth, Employee,
Attendance, Payroll), MongoDB for Notification's append-heavy schemaless logs,
Redis for ephemeral hot state.

### 4.1 Auth (PostgreSQL)

```sql
CREATE TABLE users (
  id                  UUID PRIMARY KEY,
  email               CITEXT UNIQUE NOT NULL,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('ADMIN','MANAGER','EMPLOYEE')),
  employee_id         UUID,                       -- logical link, not a DB FK (cross-service)
  failed_login_count  INT NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at      TIMESTAMPTZ
);

-- Refresh-token rotation with family-based reuse detection.
CREATE TABLE refresh_tokens (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  token_hash    TEXT NOT NULL,                    -- never store raw tokens
  family_id     UUID NOT NULL,                    -- rotation chain root
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  revoked_reason TEXT                              -- 'rotated' | 'reuse_detected' | 'logout'
);
CREATE INDEX ON refresh_tokens (user_id);
-- Login rate limiting lives in Redis (token bucket per email/IP).
```

**Refresh rotation + reuse detection:** each login starts a `family_id`. Using a
refresh token issues a new one in the same family and revokes the old. If a
*revoked* token is ever presented again → the entire family is killed. Classic
refresh-token-theft signal.

### 4.2 Employee (PostgreSQL)

```sql
CREATE TABLE departments (
  id        UUID PRIMARY KEY,
  name      TEXT NOT NULL,
  code      TEXT UNIQUE NOT NULL,
  parent_id UUID REFERENCES departments(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE employees (
  id               UUID PRIMARY KEY,
  user_id          UUID UNIQUE NOT NULL,          -- links to Auth
  email            CITEXT UNIQUE NOT NULL,
  full_name        TEXT NOT NULL,
  department_id    UUID REFERENCES departments(id),
  manager_id       UUID REFERENCES employees(id),
  job_title        TEXT,
  hire_date        DATE NOT NULL,
  employment_status TEXT NOT NULL DEFAULT 'ACTIVE',
  -- Materialized path for O(1)-ish subtree queries:
  path             LTREE NOT NULL,               -- e.g. 'root.mgr7.emp42'
  depth            INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX employees_path_gist ON employees USING GIST (path);
CREATE INDEX employees_manager_idx ON employees (manager_id);
```

**Why materialized path (ltree) over recursive CTE / closure table?**
- Recursive CTE = naive recursion; O(depth) per query, awful for deep orgs.
- Closure table = flexible but write-heavy (O(depth) rows per insert/reparent).
- **Materialized path** = subtree via `WHERE path <@ 'root.mgr7'`, ancestors via
  parsing the path. Optimized for the read-heavy org-chart workload (charts are
  rendered far more often than re-parented). Reparenting a subtree updates the
  `path` of all descendants — rare and acceptable. This is the explicit
  "non-naive" hierarchy strategy.

### 4.3 Attendance (PostgreSQL)

```sql
CREATE TYPE leave_state AS ENUM
  ('PENDING','MANAGER_REVIEW','HR_REVIEW','APPROVED','REJECTED');

CREATE TABLE leave_requests (
  id           UUID PRIMARY KEY,
  employee_id  UUID NOT NULL,
  leave_type   TEXT NOT NULL,                    -- VACATION|SICK|UNPAID|...
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  total_days   NUMERIC(5,2) NOT NULL,
  reason       TEXT,
  status       leave_state NOT NULL DEFAULT 'PENDING',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The state machine's append-only transition log (audit + replay source).
CREATE TABLE leave_transitions (
  id               UUID PRIMARY KEY,
  leave_request_id UUID NOT NULL REFERENCES leave_requests(id),
  from_state       leave_state NOT NULL,
  to_state         leave_state NOT NULL,
  actor_id         UUID NOT NULL,
  comment          TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE leave_balances (
  employee_id UUID, leave_type TEXT, year INT,
  entitled    NUMERIC(6,2) NOT NULL,
  used        NUMERIC(6,2) NOT NULL DEFAULT 0,
  pending     NUMERIC(6,2) NOT NULL DEFAULT 0,
  remaining   NUMERIC(6,2) GENERATED ALWAYS AS (entitled - used - pending) STORED,
  PRIMARY KEY (employee_id, leave_type, year)
);

CREATE TABLE clock_events (
  id              UUID PRIMARY KEY,
  employee_id     UUID NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN ('IN','OUT')),
  occurred_at     TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL,                 -- de-dupes double clock-in
  source          TEXT,                          -- web|mobile|kiosk
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (idempotency_key)
);
```

### 4.4 Payroll (PostgreSQL)

```sql
CREATE TABLE salary_configs (
  id            UUID PRIMARY KEY,
  employee_id   UUID NOT NULL,
  gross_salary  NUMERIC(12,2) NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  pay_frequency TEXT NOT NULL DEFAULT 'MONTHLY',
  effective_from DATE NOT NULL,
  effective_to   DATE
);

-- UNIQUE(idempotency_key) is the money-safety guarantee.
CREATE TABLE pay_runs (
  id             UUID PRIMARY KEY,
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING|COMPLETED|FAILED
  idempotency_key TEXT NOT NULL UNIQUE,
  total_net      NUMERIC(14,2),
  created_by     UUID,
  created_at     TIMESTAMPTZ DEFAULT now(),
  completed_at   TIMESTAMPTZ
);

CREATE TABLE payslips (
  id              UUID PRIMARY KEY,
  pay_run_id      UUID NOT NULL REFERENCES pay_runs(id),
  employee_id     UUID NOT NULL,
  gross           NUMERIC(12,2) NOT NULL,
  deductions      NUMERIC(12,2) NOT NULL DEFAULT 0,
  net             NUMERIC(12,2) NOT NULL,
  leave_unpaid_days NUMERIC(5,2) DEFAULT 0,
  regular_hours   NUMERIC(7,2),
  overtime_hours  NUMERIC(7,2),
  pdf_object_key  TEXT,                            -- S3/MinIO key
  generated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (pay_run_id, employee_id)                 -- never pay same emp twice in a run
);

-- Generic idempotency-key store for any write endpoint that needs it.
CREATE TABLE idempotency_keys (
  key              TEXT PRIMARY KEY,
  response_payload JSONB,
  status_code      INT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL
);

-- Event-fed projection of leave balances (eventually consistent, by design).
CREATE TABLE leave_balance_projection (
  employee_id   UUID, leave_type TEXT, year INT,
  used          NUMERIC(6,2) NOT NULL DEFAULT 0,
  last_event_id UUID NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (employee_id, leave_type, year)
);
```

### 4.5 Notification (MongoDB)

```js
// notifications — append-heavy, schemaless per channel
{
  _id, userId, eventType, channel: ["EMAIL","WEBSOCKET","PUSH"],
  recipient, subject, body,
  status: "PENDING"|"SENT"|"FAILED",
  eventId,            // idempotency vs the source event
  traceId,
  attempts: [{ at, result, error }],
  createdAt, sentAt
}
// Indexes: { status: 1, createdAt: 1 } for the worker poll;
//          { eventId: 1 } unique for consumer idempotency.

// dead_letters — messages that exhausted retries
{ _id, originalNotification, lastError, failedAt, originalEventId, retries }
```

### 4.6 Redis (ephemeral)

- `auth:rl:{email|ip}` — login rate-limit token buckets.
- `auth:rt:bl:{tokenHash}` — refresh-token blacklist (short TTL).
- `payroll:leave:{emp}:{type}:{year}` — hot leave-balance cache.
- `gateway:rl:{userId}` — edge rate-limit counters.
- (Circuit-breaker state can live here too if we want it shared across instances.)

---

## 5. Consistency model (the part to rehearse)

- **Strong consistency:** within a service's own DB (Auth, Employee, Attendance,
  Payroll). The leave state machine, for example, is transactional.
- **Eventual consistency:** across services, via events. Payroll's
  `leave_balance_projection` lags Attendance's authoritative balance by the
  broker's propagation delay.
- **Frontend handling:** after a manager approves leave, the UI optimistically
  shows `APPROVED` from Attendance's response; the *pay projection* section
  shows a `stale` badge (React Query) and refetches on a short interval / on
  receiving a WebSocket `payroll.projection.updated` nudge. We never *block* the
  user on cross-service propagation — we surface it honestly.
- **No distributed 2PC / sagas with compensations are needed** for the happy
  path because Notification/Payroll are pure projections; if they drift, they
  replay events. (We'd reach for saga if a downstream write had to *reject* an
  upstream decision.)

---

## 6. Distributed-systems mechanisms (mapped to where they live)

| Mechanism | Where | How |
|---|---|---|
| Idempotency keys | Payroll `pay_runs.idempotency_key`, generic `idempotency_keys` table, consumer `eventId` dedupe | duplicate key → return cached response, no re-execution |
| Transactional outbox | every producer service | domain write + outbox row in one txn; relay publishes |
| Circuit breaker | Gateway + inter-service HTTP clients (`opossum`) | trips on error rate; half-open probe; fail fast instead of cascade |
| Distributed tracing | all services | `traceparent`/`x-trace-id` in + out of every call and every event |
| Dead-letter queue | Notification (and broker-wide DLX) | exhausted retries → DLQ; core flows unaffected |
| Graceful degradation | Notification is a pure consumer | broker buffers; nothing waits on it synchronously |
| Health/readiness | every service `/healthz`, `/readyz` | k8s probes + docker-compose `depends_on: condition: service_healthy` |
| Metrics | every service `/metrics` | Prometheus text format via `prom-client` |

---

## 7. Tech stack (recommended, pending confirmation)

- **Backend:** Node.js + TypeScript + **NestJS** (DI, modules, decorators → clean
  service boundaries; one language across stack).
- **Broker:** **RabbitMQ** (native DLX/DLQ, simpler ops at this throughput;
  Kafka if we later need an append-log with replay at much higher volume).
- **Gateway:** **custom NestJS** gateway (auditable auth/rate-limit/circuit-break).
- **DBs:** PostgreSQL, MongoDB, Redis.
- **Frontend:** React + TypeScript + React Query + Tailwind.
- **Containers:** Docker + docker-compose; k8s manifests included (not deployed).
- **Observability:** Pino structured logs, `prom-client` metrics, header-based
  trace propagation.
