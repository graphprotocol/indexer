import type { Logger } from '@graphprotocol/common-ts'
import { QueryTypes, type QueryInterface } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}

// Restrict the discovered enum type name to a Postgres identifier shape
// before interpolating it into DDL — defence in depth in case the lookup
// ever returns something unexpected.
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  if (!(await queryInterface.tableExists('Actions'))) {
    logger.debug('Actions table does not exist; skipping reallocate enum drop')
    return
  }

  const sequelize = queryInterface.sequelize

  // Look up the enum type backing Actions.type instead of assuming Sequelize's
  // default naming, so the migration works regardless of how the column was
  // originally created.
  const [enumTypeRow] = (await sequelize.query(
    `SELECT udt_name
     FROM information_schema.columns
     WHERE table_name = 'Actions' AND column_name = 'type'`,
    { type: QueryTypes.SELECT },
  )) as Array<{ udt_name: string }>

  if (!enumTypeRow?.udt_name) {
    logger.debug('Actions.type column not found; skipping reallocate enum drop')
    return
  }

  const enumTypeName = enumTypeRow.udt_name
  if (!SAFE_IDENTIFIER.test(enumTypeName)) {
    throw new Error(
      `Refusing to mutate enum type with unsafe name: ${enumTypeName}`,
    )
  }
  const enumOldName = `${enumTypeName}_old`

  const enumValues = (await sequelize.query(
    `SELECT enumlabel
     FROM pg_enum
     WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = '${enumTypeName}')`,
    { type: QueryTypes.SELECT },
  )) as Array<{ enumlabel: string }>

  if (!enumValues.some(v => v.enumlabel === 'reallocate')) {
    logger.debug(`'reallocate' already removed from ${enumTypeName}; skipping`)
    return
  }

  // Wrap the DELETE + type swap in a transaction so a partial failure can't
  // leave the database with a half-renamed enum and a stranded "_old" type.
  await sequelize.transaction(async transaction => {
    const [countRow] = (await sequelize.query(
      `SELECT count(*)::int AS count FROM "Actions" WHERE type = 'reallocate'`,
      { type: QueryTypes.SELECT, transaction },
    )) as Array<{ count: number }>
    const deletedCount = countRow?.count ?? 0

    if (deletedCount > 0) {
      await sequelize.query(`DELETE FROM "Actions" WHERE type = 'reallocate'`, {
        transaction,
      })
      logger.info(
        `Removed ${deletedCount} stale row(s) from Actions with type='reallocate'`,
      )
    }

    logger.info(`Recreating ${enumTypeName} without 'reallocate'`)
    await sequelize.query(
      `ALTER TYPE "${enumTypeName}" RENAME TO "${enumOldName}"`,
      { transaction },
    )
    await sequelize.query(
      `CREATE TYPE "${enumTypeName}" AS ENUM ('allocate', 'unallocate', 'presentPOI', 'resize')`,
      { transaction },
    )
    await sequelize.query(
      `ALTER TABLE "Actions"
         ALTER COLUMN type TYPE "${enumTypeName}"
         USING type::text::"${enumTypeName}"`,
      { transaction },
    )
    await sequelize.query(`DROP TYPE "${enumOldName}"`, { transaction })
  })
}

export async function down(): Promise<void> {
  throw new Error(
    'migration 27-actions-drop-reallocate-enum-value is not reversible',
  )
}
