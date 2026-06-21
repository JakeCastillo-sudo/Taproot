/**
 * 034 — scheduling: studio rooms, class templates, sessions, reservations, waitlist (v2.2)
 *
 * The calendar/booking domain the Counter Bridge (v2.3) sits on. DORMANT for
 * restaurants — exposed only for capabilities.studio orgs; every service
 * graceful-guards these tables so the branch is safe BEFORE this migration runs.
 * Money = INTEGER CENTS. All tables org-scoped. Pattern matches 028-033.
 * DO NOT run here — Jake runs it in Railway after review (two-step verify in notes).
 *
 * ⚠ NAMESPACING: these tables are deliberately prefixed (studio_rooms,
 * class_reservations, class_waitlist) to avoid the EXISTING restaurant tables —
 * `reservations` (migration 016, table-booking/waitlist) and `tables` (001). The
 * studio domain must NOT collide with restaurant table-booking.
 *
 * ── TIME MODEL (full rationale in docs/V2_2_SANDBOX_NOTES.md) ──
 *  • class_templates = the recurring DEFINITION + policy defaults.
 *  • class_sessions  = concrete DATED instances (timestamptz, UTC). Sessions COPY
 *    policy fields from the template at generation, so editing a template never
 *    retroactively mutates already-generated sessions.
 *  • Materialization is EAGER: generateSessions() expands recurrence into real
 *    class_sessions rows (reservations FK to real rows). Idempotent via
 *    uq_class_sessions_template_start. Auto-generation-ahead is v2.4.
 *  • Timezone: starts_at/ends_at = (occurrence_date + local_time) AT TIME ZONE
 *    location_tz — DST-correct, matching the codebase's AT TIME ZONE convention.
 *
 * ── ENUMS ──
 *  class_sessions.status        : scheduled | live | closed | cancelled
 *  class_reservations.source    : member_app | widget | staff | kiosk | api
 *  class_reservations.state     : booked | waitlisted | checked_in | late_cancel | no_show | completed
 *    (a clean EARLY cancel sets deleted_at — frees the spot, restores the credit —
 *     rather than a state, so only penalty states late_cancel/no_show are tracked.)
 *
 * ── recurrence jsonb (class_templates.recurrence) ──
 *   { "freq": "weekly", "days": [0,2,4], "time": "18:00", "until": "2026-12-31" }
 *   days: 0=Sun..6=Sat (JS getDay / Postgres EXTRACT(DOW)). time: local HH:MM in the
 *   location timezone. v2.2 supports weekly only (covers ~all studio schedules).
 */

exports.up = (pgm) => {
  // ── studio_rooms ──
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS studio_rooms (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      location_id      uuid          REFERENCES locations(id) ON DELETE SET NULL,
      name             varchar(255)  NOT NULL,
      capacity         integer       NOT NULL DEFAULT 0,
      created_at       timestamptz   NOT NULL DEFAULT now(),
      updated_at       timestamptz   NOT NULL DEFAULT now(),
      deleted_at       timestamptz
    );
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_studio_rooms_org ON studio_rooms(organization_id) WHERE deleted_at IS NULL;`);

  // ── class_templates (recurring definition + policy defaults) ──
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS class_templates (
      id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id        uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      location_id            uuid          REFERENCES locations(id) ON DELETE SET NULL,
      name                   varchar(255)  NOT NULL,
      discipline             varchar(100),
      instructor_default_id  uuid          REFERENCES employees(id) ON DELETE SET NULL,
      duration_min           integer       NOT NULL DEFAULT 60,
      capacity               integer       NOT NULL DEFAULT 0,
      room_id                uuid          REFERENCES studio_rooms(id) ON DELETE SET NULL,
      price_drop_in          integer       NOT NULL DEFAULT 0,
      credits_required       integer       NOT NULL DEFAULT 1,
      recurrence             jsonb         NOT NULL DEFAULT '{}'::jsonb,
      booking_window_hours   integer       NOT NULL DEFAULT 168,
      cancel_cutoff_min      integer       NOT NULL DEFAULT 720,
      noshow_window_min      integer       NOT NULL DEFAULT 15,
      created_at             timestamptz   NOT NULL DEFAULT now(),
      updated_at             timestamptz   NOT NULL DEFAULT now(),
      deleted_at             timestamptz
    );
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_class_templates_org ON class_templates(organization_id) WHERE deleted_at IS NULL;`);

  // ── class_sessions (concrete dated instances) ──
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS class_sessions (
      id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id     uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      location_id         uuid          REFERENCES locations(id) ON DELETE SET NULL,
      template_id         uuid          REFERENCES class_templates(id) ON DELETE SET NULL,
      name                varchar(255)  NOT NULL,
      discipline          varchar(100),
      starts_at           timestamptz   NOT NULL,
      ends_at             timestamptz   NOT NULL,
      instructor_id       uuid          REFERENCES employees(id) ON DELETE SET NULL,
      room_id             uuid          REFERENCES studio_rooms(id) ON DELETE SET NULL,
      capacity            integer       NOT NULL DEFAULT 0,
      credits_required    integer       NOT NULL DEFAULT 1,
      price_drop_in       integer       NOT NULL DEFAULT 0,
      status              varchar(20)   NOT NULL DEFAULT 'scheduled',
      booking_opens_at    timestamptz,
      booking_closes_at   timestamptz,
      cancel_cutoff_min   integer       NOT NULL DEFAULT 720,
      noshow_window_min   integer       NOT NULL DEFAULT 15,
      created_at          timestamptz   NOT NULL DEFAULT now(),
      updated_at          timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT class_sessions_status_check CHECK (status IN ('scheduled','live','closed','cancelled'))
    );
  `);
  // Hot read: upcoming sessions by org + location + start time (listed/polled often).
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_class_sessions_upcoming ON class_sessions(organization_id, location_id, starts_at);`);
  // Idempotent generation: never two sessions for the same template + start instant.
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS uq_class_sessions_template_start ON class_sessions(template_id, starts_at) WHERE template_id IS NOT NULL;`);

  // ── class_reservations ──
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS class_reservations (
      id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id   uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      session_id        uuid          NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
      member_id         uuid          NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      source            varchar(20)   NOT NULL DEFAULT 'staff',
      state             varchar(20)   NOT NULL DEFAULT 'booked',
      credit_txn_id     uuid,
      add_on_order_id   uuid,
      booked_at         timestamptz   NOT NULL DEFAULT now(),
      checked_in_at     timestamptz,
      created_at        timestamptz   NOT NULL DEFAULT now(),
      updated_at        timestamptz   NOT NULL DEFAULT now(),
      deleted_at        timestamptz,
      CONSTRAINT class_reservations_source_check CHECK (source IN ('member_app','widget','staff','kiosk','api')),
      CONSTRAINT class_reservations_state_check  CHECK (state  IN ('booked','waitlisted','checked_in','late_cancel','no_show','completed'))
    );
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_class_reservations_session ON class_reservations(session_id) WHERE deleted_at IS NULL;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_class_reservations_member  ON class_reservations(member_id)  WHERE deleted_at IS NULL;`);
  // A member can't double-book the same session while holding an active reservation.
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS uq_class_reservations_active
             ON class_reservations(session_id, member_id)
             WHERE state NOT IN ('late_cancel','no_show') AND deleted_at IS NULL;`);

  // ── class_waitlist (auto-promote engine is v2.4; here: store + manual promote) ──
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS class_waitlist (
      id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      session_id       uuid          NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
      member_id        uuid          NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      position         integer       NOT NULL DEFAULT 0,
      auto_promote     boolean       NOT NULL DEFAULT true,
      notified_at      timestamptz,
      created_at       timestamptz   NOT NULL DEFAULT now(),
      deleted_at       timestamptz
    );
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_class_waitlist_session ON class_waitlist(session_id) WHERE deleted_at IS NULL;`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS uq_class_waitlist_active ON class_waitlist(session_id, member_id) WHERE deleted_at IS NULL;`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS class_waitlist;`);
  pgm.sql(`DROP TABLE IF EXISTS class_reservations;`);
  pgm.sql(`DROP TABLE IF EXISTS class_sessions;`);
  pgm.sql(`DROP TABLE IF EXISTS class_templates;`);
  pgm.sql(`DROP TABLE IF EXISTS studio_rooms;`);
};
