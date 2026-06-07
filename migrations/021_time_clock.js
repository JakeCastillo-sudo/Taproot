/**
 * 021 — Time clock + schedules (S9-02)
 *
 * time_clock_entries: clock-in/out records with computed hours + labor cost.
 * schedules:          planned shifts (optionally AI-suggested).
 */

exports.up = (pgm) => {
  pgm.createTable('time_clock_entries', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    organization_id: {
      type: 'uuid',
      notNull: true,
      references: 'organizations(id)',
      onDelete: 'CASCADE',
    },
    employee_id: {
      type: 'uuid',
      notNull: true,
      references: 'employees(id)',
      onDelete: 'CASCADE',
    },
    location_id: {
      type: 'uuid',
      notNull: true,
      references: 'locations(id)',
      onDelete: 'CASCADE',
    },
    clocked_in_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    clocked_out_at: { type: 'timestamptz' },
    break_minutes: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    hours_worked: { type: 'numeric(5,2)' },
    hourly_rate: { type: 'numeric(10,2)' },
    labor_cost: { type: 'numeric(10,2)' },
    notes: { type: 'text' },
  });

  pgm.createTable('schedules', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    organization_id: {
      type: 'uuid',
      notNull: true,
      references: 'organizations(id)',
      onDelete: 'CASCADE',
    },
    employee_id: {
      type: 'uuid',
      notNull: true,
      references: 'employees(id)',
      onDelete: 'CASCADE',
    },
    location_id: {
      type: 'uuid',
      notNull: true,
      references: 'locations(id)',
      onDelete: 'CASCADE',
    },
    shift_date: { type: 'date', notNull: true },
    shift_start: { type: 'timetz', notNull: true },
    shift_end: { type: 'timetz', notNull: true },
    role: { type: 'varchar(50)' },
    notes: { type: 'text' },
    ai_suggested: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('time_clock_entries',
    ['organization_id', 'employee_id', 'clocked_in_at'],
    { name: 'idx_time_clock_org_emp_date' });
  pgm.createIndex('schedules',
    ['organization_id', 'shift_date'],
    { name: 'idx_schedules_org_date' });
};

exports.down = (pgm) => {
  pgm.dropTable('schedules');
  pgm.dropTable('time_clock_entries');
};
