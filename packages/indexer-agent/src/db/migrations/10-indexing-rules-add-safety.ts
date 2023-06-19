import { Logger } from '@tokene-q/common-ts'
import { DataTypes, QueryInterface } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.debug(`Checking if indexing rules table exists`)
  const tables = await queryInterface.showAllTables()
  if (!tables.includes('IndexingRules')) {
    logger.info(`Indexing rules table does not exist, migration not necessary`)
    return
  }

  logger.debug(`Checking if 'IndexingRules' table needs to be migrated`)
  const table = await queryInterface.describeTable('IndexingRules')
  const safetyColumn = table.safety
  if (safetyColumn) {
    logger.info(`'safety' column already exist, migration not necessary`)
    return
  }

  logger.info(`Add 'safety' column to 'IndexingRules' table`)
  await queryInterface.addColumn('IndexingRules', 'safety', {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  })
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  return await queryInterface.sequelize.transaction({}, async transaction => {
    const tables = await queryInterface.showAllTables()

    if (tables.includes('IndexingRules')) {
      logger.info(`Remove 'safety' column`)
      await context.queryInterface.removeColumn('IndexingRules', 'safety', {
        transaction,
      })
    }
  })
}
