import { Logger } from '@graphprotocol/common-ts'
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
  const subgraphTagColumn = table.tag
  if (subgraphTagColumn) {
    logger.info(`'tag' column already exists, migration not necessary`)
    return
  }

  logger.info(`Add 'tag' column to 'IndexingRules' table`)
  await queryInterface.addColumn('IndexingRules', 'tag', {
    type: DataTypes.STRING,
    primaryKey: false,
    defaultValue: 'indexer-agent',
  })
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  return await queryInterface.sequelize.transaction({}, async transaction => {
    const tables = await queryInterface.showAllTables()

    if (tables.includes('IndexingRules')) {
      logger.info(`Remove 'tag' column`)
      await context.queryInterface.removeColumn('IndexingRules', 'tag', {
        transaction,
      })
    }
  })
}
