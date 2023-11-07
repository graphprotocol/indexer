import { Logger } from '@graphprotocol/common-ts'
import { QueryTypes, QueryInterface } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}

const UNIQUE_INDEX_NAME = 'idx_unique_identifier_and_protocol_network'

export async function up({ context }: Context): Promise<void> {
  const { queryInterface } = context

  const primaryKeyName = await getPrimaryKeyName(queryInterface)
  await alterTable(primaryKeyName, queryInterface)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function down({ context }: Context): Promise<void> {
  /* TODO
  - Drop partial unique index on IndexingRules (identifier)
  - Infer the name and drop the unique constraint from (identifier, protocolNetwork)
  - Add NOT NULL back to protocolNetwork, possibly removing rows where it's NULL
  - Infer the name and drop primary key on id
  - Create a primary key on (identifier, protocolNetwork)
   */
}

async function getPrimaryKeyName(
  queryInterface: QueryInterface,
): Promise<string> {
  const sql = `
SELECT
    conname
FROM
    pg_constraint
    INNER JOIN pg_class ON pg_constraint.conrelid = pg_class.oid
    INNER JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE
    pg_class.relname = 'IndexingRules'
    AND pg_namespace.nspname = 'public'
    AND pg_constraint.contype = 'p';
`
  const result: null | { conname?: string } =
    await queryInterface.sequelize.query(sql, {
      type: QueryTypes.SELECT,
      raw: true,
      plain: true,
    })

  if (!result || !result.conname) {
    throw new Error(
      `Failed to infer primary key constraint name for the 'IndexingRules' table.`,
    )
  }
  return result.conname
}

async function alterTable(
  primaryKey: string,
  queryInterface: QueryInterface,
): Promise<void> {
  const alterTableSql = `
ALTER TABLE "IndexingRules"
    DROP CONSTRAINT "${primaryKey}",
    ADD PRIMARY KEY (id),
    ALTER COLUMN "protocolNetwork" DROP NOT NULL,
    ADD UNIQUE ("identifier", "protocolNetwork");
`

  // We still need this partial index to enforce "identifier" uniqueness when
  // "protocolNetwork" is null.
  const createUniqueIndexSql = `
CREATE UNIQUE INDEX ${UNIQUE_INDEX_NAME} ON "IndexingRules" ("identifier")
WHERE
    "protocolNetwork" IS NULL;
`
  await queryInterface.sequelize.query(alterTableSql)
  await queryInterface.sequelize.query(createUniqueIndexSql)
}
