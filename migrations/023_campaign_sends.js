/**
 * Migration 023 — campaign_sends
 *
 * Dedup ledger for the weekly marketing campaign system (jobs/weeklyCampaign.job.ts).
 * One row per (organization, campaign_slug) so a campaign is never sent twice — the
 * slug embeds the send date (e.g. "weekly_stats_2026-06-13"), so the same campaign
 * type recurs next cycle under a new slug.
 *
 * Code degrades gracefully until this runs: the job checks for the table first.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.createTable('campaign_sends', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    organization_id: {
      type: 'uuid',
      references: 'organizations(id)',
      onDelete: 'CASCADE',
    },
    campaign_slug: { type: 'varchar(100)', notNull: true },
    sent_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint(
    'campaign_sends',
    'unique_org_campaign',
    'UNIQUE (organization_id, campaign_slug)',
  );
  pgm.createIndex('campaign_sends', 'organization_id');
  pgm.createIndex('campaign_sends', 'sent_at');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('campaign_sends');
};
