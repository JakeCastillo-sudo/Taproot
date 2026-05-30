'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE mfa_backup_codes (
      id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id  uuid          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      code_hash    varchar(255)  NOT NULL,
      used_at      timestamptz,
      created_at   timestamptz   NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`CREATE INDEX idx_mfa_backup_employee ON mfa_backup_codes(employee_id);`);
  pgm.sql(`CREATE INDEX idx_mfa_backup_unused   ON mfa_backup_codes(employee_id) WHERE used_at IS NULL;`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS mfa_backup_codes CASCADE;`);
};
