# Module migrations

Feature modules may own SQL migrations under this directory. Migration filenames use the same globally monotonic `NNN_description.sql` contract as the core migrations; version collisions are rejected before any SQL is applied.

The migration host does not scan this directory at runtime. A composition must explicitly provide each owned migration as `{ ownerId, version, sql }`; the migration host verifies its checksum, takes the existing PostgreSQL advisory lock, and applies it before `app` or `bot` starts. A module migration must be additive, reversible at the data-model level, and must not contain credentials or environment-specific values.
