-- custom-permission-guard POC — schema init for the 4 demo apps.
-- One MariaDB instance, 4 schemas (one per app). Tables adapted from
-- __PLAN/expected-custom-permission-guard/tables.sql. The *_single_db
-- schemas additionally put a UNIQUE(account_id) on account_groups so
-- groupMode "single" is a real structural invariant of THIS schema — the
-- lib itself never enforces cardinality (see tables.sql's own comment on
-- account_groups), it's the consumer schema's job.

CREATE DATABASE IF NOT EXISTS express_single_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS express_multiple_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS nest_single_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS nest_multiple_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── express_single_db (groupMode: single) ─────────────────────────────────
CREATE TABLE express_single_db.accounts (
  id   VARCHAR(64)  NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);
CREATE TABLE express_single_db.domains (
  id       INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name     VARCHAR(255) NOT NULL,
  owner_id VARCHAR(64)  NULL,
  CONSTRAINT fk_es_domains_owner FOREIGN KEY (owner_id) REFERENCES express_single_db.accounts (id) ON DELETE SET NULL
);
CREATE TABLE express_single_db.`groups` (
  id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT         NULL,
  owner_id    VARCHAR(64)  NULL,
  is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_es_groups_owner FOREIGN KEY (owner_id) REFERENCES express_single_db.accounts (id) ON DELETE SET NULL
);
CREATE TABLE express_single_db.account_groups (
  account_id VARCHAR(64) NOT NULL,
  group_id   INT         NOT NULL,
  PRIMARY KEY (account_id, group_id),
  UNIQUE KEY uq_es_single_account (account_id),
  CONSTRAINT fk_es_ag_account FOREIGN KEY (account_id) REFERENCES express_single_db.accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_es_ag_group FOREIGN KEY (group_id) REFERENCES express_single_db.`groups` (id) ON DELETE CASCADE
);
CREATE TABLE express_single_db.group_global_permissions (
  group_id INT          NOT NULL,
  resource VARCHAR(100) NOT NULL,
  action   VARCHAR(20)  NOT NULL,
  PRIMARY KEY (group_id, resource, action),
  CONSTRAINT fk_es_ggp_group FOREIGN KEY (group_id) REFERENCES express_single_db.`groups` (id) ON DELETE CASCADE
);
CREATE TABLE express_single_db.group_domain_permissions (
  group_id  INT          NOT NULL,
  domain_id INT          NOT NULL,
  resource  VARCHAR(100) NOT NULL,
  action    VARCHAR(20)  NOT NULL,
  PRIMARY KEY (group_id, domain_id, resource, action),
  CONSTRAINT fk_es_gdp_group FOREIGN KEY (group_id) REFERENCES express_single_db.`groups` (id) ON DELETE CASCADE,
  CONSTRAINT fk_es_gdp_domain FOREIGN KEY (domain_id) REFERENCES express_single_db.domains (id) ON DELETE CASCADE
);

-- ─── express_multiple_db (groupMode: multiple) ─────────────────────────────
CREATE TABLE express_multiple_db.accounts (
  id   VARCHAR(64)  NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);
CREATE TABLE express_multiple_db.domains (
  id       INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name     VARCHAR(255) NOT NULL,
  owner_id VARCHAR(64)  NULL,
  CONSTRAINT fk_em_domains_owner FOREIGN KEY (owner_id) REFERENCES express_multiple_db.accounts (id) ON DELETE SET NULL
);
CREATE TABLE express_multiple_db.`groups` (
  id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT         NULL,
  owner_id    VARCHAR(64)  NULL,
  is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_em_groups_owner FOREIGN KEY (owner_id) REFERENCES express_multiple_db.accounts (id) ON DELETE SET NULL
);
CREATE TABLE express_multiple_db.account_groups (
  account_id VARCHAR(64) NOT NULL,
  group_id   INT         NOT NULL,
  PRIMARY KEY (account_id, group_id),
  CONSTRAINT fk_em_ag_account FOREIGN KEY (account_id) REFERENCES express_multiple_db.accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_em_ag_group FOREIGN KEY (group_id) REFERENCES express_multiple_db.`groups` (id) ON DELETE CASCADE
);
CREATE TABLE express_multiple_db.group_global_permissions (
  group_id INT          NOT NULL,
  resource VARCHAR(100) NOT NULL,
  action   VARCHAR(20)  NOT NULL,
  PRIMARY KEY (group_id, resource, action),
  CONSTRAINT fk_em_ggp_group FOREIGN KEY (group_id) REFERENCES express_multiple_db.`groups` (id) ON DELETE CASCADE
);
CREATE TABLE express_multiple_db.group_domain_permissions (
  group_id  INT          NOT NULL,
  domain_id INT          NOT NULL,
  resource  VARCHAR(100) NOT NULL,
  action    VARCHAR(20)  NOT NULL,
  PRIMARY KEY (group_id, domain_id, resource, action),
  CONSTRAINT fk_em_gdp_group FOREIGN KEY (group_id) REFERENCES express_multiple_db.`groups` (id) ON DELETE CASCADE,
  CONSTRAINT fk_em_gdp_domain FOREIGN KEY (domain_id) REFERENCES express_multiple_db.domains (id) ON DELETE CASCADE
);

-- ─── nest_single_db (groupMode: single) ────────────────────────────────────
CREATE TABLE nest_single_db.accounts (
  id   VARCHAR(64)  NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);
CREATE TABLE nest_single_db.domains (
  id       INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name     VARCHAR(255) NOT NULL,
  owner_id VARCHAR(64)  NULL,
  CONSTRAINT fk_ns_domains_owner FOREIGN KEY (owner_id) REFERENCES nest_single_db.accounts (id) ON DELETE SET NULL
);
CREATE TABLE nest_single_db.`groups` (
  id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT         NULL,
  owner_id    VARCHAR(64)  NULL,
  is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ns_groups_owner FOREIGN KEY (owner_id) REFERENCES nest_single_db.accounts (id) ON DELETE SET NULL
);
CREATE TABLE nest_single_db.account_groups (
  account_id VARCHAR(64) NOT NULL,
  group_id   INT         NOT NULL,
  PRIMARY KEY (account_id, group_id),
  UNIQUE KEY uq_ns_single_account (account_id),
  CONSTRAINT fk_ns_ag_account FOREIGN KEY (account_id) REFERENCES nest_single_db.accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_ns_ag_group FOREIGN KEY (group_id) REFERENCES nest_single_db.`groups` (id) ON DELETE CASCADE
);
CREATE TABLE nest_single_db.group_global_permissions (
  group_id INT          NOT NULL,
  resource VARCHAR(100) NOT NULL,
  action   VARCHAR(20)  NOT NULL,
  PRIMARY KEY (group_id, resource, action),
  CONSTRAINT fk_ns_ggp_group FOREIGN KEY (group_id) REFERENCES nest_single_db.`groups` (id) ON DELETE CASCADE
);
CREATE TABLE nest_single_db.group_domain_permissions (
  group_id  INT          NOT NULL,
  domain_id INT          NOT NULL,
  resource  VARCHAR(100) NOT NULL,
  action    VARCHAR(20)  NOT NULL,
  PRIMARY KEY (group_id, domain_id, resource, action),
  CONSTRAINT fk_ns_gdp_group FOREIGN KEY (group_id) REFERENCES nest_single_db.`groups` (id) ON DELETE CASCADE,
  CONSTRAINT fk_ns_gdp_domain FOREIGN KEY (domain_id) REFERENCES nest_single_db.domains (id) ON DELETE CASCADE
);

-- ─── nest_multiple_db (groupMode: multiple) ────────────────────────────────
CREATE TABLE nest_multiple_db.accounts (
  id   VARCHAR(64)  NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);
CREATE TABLE nest_multiple_db.domains (
  id       INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name     VARCHAR(255) NOT NULL,
  owner_id VARCHAR(64)  NULL,
  CONSTRAINT fk_nm_domains_owner FOREIGN KEY (owner_id) REFERENCES nest_multiple_db.accounts (id) ON DELETE SET NULL
);
CREATE TABLE nest_multiple_db.`groups` (
  id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT         NULL,
  owner_id    VARCHAR(64)  NULL,
  is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_nm_groups_owner FOREIGN KEY (owner_id) REFERENCES nest_multiple_db.accounts (id) ON DELETE SET NULL
);
CREATE TABLE nest_multiple_db.account_groups (
  account_id VARCHAR(64) NOT NULL,
  group_id   INT         NOT NULL,
  PRIMARY KEY (account_id, group_id),
  CONSTRAINT fk_nm_ag_account FOREIGN KEY (account_id) REFERENCES nest_multiple_db.accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_nm_ag_group FOREIGN KEY (group_id) REFERENCES nest_multiple_db.`groups` (id) ON DELETE CASCADE
);
CREATE TABLE nest_multiple_db.group_global_permissions (
  group_id INT          NOT NULL,
  resource VARCHAR(100) NOT NULL,
  action   VARCHAR(20)  NOT NULL,
  PRIMARY KEY (group_id, resource, action),
  CONSTRAINT fk_nm_ggp_group FOREIGN KEY (group_id) REFERENCES nest_multiple_db.`groups` (id) ON DELETE CASCADE
);
CREATE TABLE nest_multiple_db.group_domain_permissions (
  group_id  INT          NOT NULL,
  domain_id INT          NOT NULL,
  resource  VARCHAR(100) NOT NULL,
  action    VARCHAR(20)  NOT NULL,
  PRIMARY KEY (group_id, domain_id, resource, action),
  CONSTRAINT fk_nm_gdp_group FOREIGN KEY (group_id) REFERENCES nest_multiple_db.`groups` (id) ON DELETE CASCADE,
  CONSTRAINT fk_nm_gdp_domain FOREIGN KEY (domain_id) REFERENCES nest_multiple_db.domains (id) ON DELETE CASCADE
);
