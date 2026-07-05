// Adapted from /var/docker/_libs/__PLAN/expected-custom-permission-guard/tables.sql
// (single schema — integration tests don't need the 4-schema split the POCs use).
export const SQL_SCHEMA = `
CREATE TABLE accounts (
  id   VARCHAR(64)  NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);

CREATE TABLE domains (
  id       INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name     VARCHAR(255) NOT NULL,
  owner_id VARCHAR(64)  NULL,
  CONSTRAINT fk_domains_owner
    FOREIGN KEY (owner_id) REFERENCES accounts (id) ON DELETE SET NULL
);

CREATE TABLE \`groups\` (
  id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT         NULL,
  owner_id    VARCHAR(64)  NULL,
  is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_groups_owner
    FOREIGN KEY (owner_id) REFERENCES accounts (id) ON DELETE SET NULL
);

CREATE TABLE account_groups (
  account_id VARCHAR(64) NOT NULL,
  group_id   INT         NOT NULL,
  PRIMARY KEY (account_id, group_id),
  CONSTRAINT fk_account_groups_account
    FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_account_groups_group
    FOREIGN KEY (group_id) REFERENCES \`groups\` (id) ON DELETE CASCADE
);

CREATE TABLE group_global_permissions (
  group_id INT          NOT NULL,
  resource VARCHAR(100) NOT NULL,
  action   VARCHAR(20)  NOT NULL,
  PRIMARY KEY (group_id, resource, action),
  CONSTRAINT fk_group_global_permissions_group
    FOREIGN KEY (group_id) REFERENCES \`groups\` (id) ON DELETE CASCADE
);

CREATE TABLE group_domain_permissions (
  group_id  INT          NOT NULL,
  domain_id INT          NOT NULL,
  resource  VARCHAR(100) NOT NULL,
  action    VARCHAR(20)  NOT NULL,
  PRIMARY KEY (group_id, domain_id, resource, action),
  CONSTRAINT fk_group_domain_permissions_group
    FOREIGN KEY (group_id) REFERENCES \`groups\` (id) ON DELETE CASCADE,
  CONSTRAINT fk_group_domain_permissions_domain
    FOREIGN KEY (domain_id) REFERENCES domains (id) ON DELETE CASCADE
);
`;
