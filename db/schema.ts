import { sqliteTable, text, integer, uniqueIndex, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const members=sqliteTable('team_members',{
  id:text('id').primaryKey(), name:text('name').notNull(), group:text('group_name').notNull().default(''),
  status:text('status').notNull().default('active'), version:integer('version').notNull().default(1),
  affiliation:text('affiliation').notNull().default('unspecified'),
  stageMode:text('stage_mode').notNull().default('unspecified'),cohortYear:integer('cohort_year'),
  internalHistory:integer('internal_history',{mode:'boolean'}).notNull().default(false),
  generation:integer('generation'),
  gradeOverrides:text('grade_overrides').notNull().default('{}'),
  nameKey:text('name_key').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),deletedAt:text('deleted_at'),
},t=>[uniqueIndex('team_members_name_key').on(t.nameKey).where(sql`${t.deletedAt} IS NULL`)]);
export const matches=sqliteTable('team_matches',{
  id:text('id').primaryKey(),date:text('match_date').notNull(),payload:text('payload').notNull(),
  fingerprint:text('fingerprint').notNull(),version:integer('version').notNull().default(1),
  createdBy:text('created_by').notNull(),createdByName:text('created_by_name').notNull(),
  updatedBy:text('updated_by').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
  deletedAt:text('deleted_at'),
},t=>[uniqueIndex('team_matches_active_fingerprint').on(t.fingerprint).where(sql`${t.deletedAt} IS NULL`)]);

export const matchFeedback=sqliteTable('team_match_feedback',{
  ownerId:text('owner_id').notNull(),matchId:text('match_id').notNull(),ownerMemberId:text('owner_member_id'),
  matchContext:text('match_context').notNull(),goodPoints:text('good_points').notNull().default(''),
  improvements:text('improvements').notNull().default(''),nextAction:text('next_action').notNull().default(''),
  version:integer('version').notNull().default(1),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.matchId]})]);
export const accessSettings=sqliteTable('access_settings',{
 id:text('id').primaryKey(),phraseHash:text('phrase_hash').notNull(),phraseSalt:text('phrase_salt').notNull(),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
});
export const accessAccounts=sqliteTable('access_accounts',{
 id:text('id').primaryKey(),memberId:text('member_id').unique(),name:text('name').notNull(),
 loginId:text('login_id').notNull(),loginKey:text('login_key').notNull().unique(),role:text('role').notNull(),
 pinHash:text('pin_hash').notNull(),pinSalt:text('pin_salt').notNull(),recoveryHash:text('recovery_hash').notNull(),
 failedAttempts:integer('failed_attempts').notNull().default(0),attemptVersion:integer('attempt_version').notNull().default(0),
 credentialVersion:integer('credential_version').notNull().default(1),disabled:integer('disabled').notNull().default(0),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
});
export const accessSessions=sqliteTable('access_sessions',{
 tokenHash:text('token_hash').primaryKey(),accountId:text('account_id').notNull(),
 credentialVersion:integer('credential_version').notNull(),expiresAt:text('expires_at').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('access_sessions_expiry').on(t.expiresAt)]);
export const accessInvites=sqliteTable('access_invites',{
 id:text('id').primaryKey(),memberId:text('member_id').notNull(),role:text('role').notNull(),
 loginId:text('login_id').notNull(),loginKey:text('login_key').notNull(),tokenHash:text('token_hash').notNull().unique(),
 expiresAt:text('expires_at').notNull(),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull(),
 redeemedAt:text('redeemed_at'),revokedAt:text('revoked_at'),
},t=>[uniqueIndex('access_invites_active_member').on(t.memberId).where(sql`${t.redeemedAt} IS NULL AND ${t.revokedAt} IS NULL`),uniqueIndex('access_invites_active_login_key').on(t.loginKey).where(sql`${t.redeemedAt} IS NULL AND ${t.revokedAt} IS NULL`)]);
export const accessLimits=sqliteTable('access_limits',{
 id:text('id').primaryKey(),attempts:integer('attempts').notNull(),expiresAt:text('expires_at').notNull(),
},t=>[index('access_limits_expiry').on(t.expiresAt)]);
