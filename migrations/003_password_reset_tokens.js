'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE password_reset_tokens (
      id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id  uuid          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      token_hash   varchar(255)  NOT NULL,
      expires_at   timestamptz   NOT NULL,
      used_at      timestamptz,
      created_at   timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT password_reset_tokens_hash_unique UNIQUE (token_hash)
    );
  `);

  pgm.sql(`CREATE INDEX idx_prt_employee   ON password_reset_tokens(employee_id);`);
  pgm.sql(`CREATE INDEX idx_prt_token_hash ON password_reset_tokens(token_hash);`);
  pgm.sql(`CREATE INDEX idx_prt_expires    ON password_reset_tokens(expires_at) WHERE used_at IS NULL;`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS password_reset_tokens CASCADE;`);
};
