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
  const autoRenewal = table.autoRenewal
  if (autoRenewal) {
    logger.info(`'autoRenewal' columns already exist, migration not necessary`)
    return
  }

  logger.info(`Add 'autoRenewal' column to 'IndexingRules' table`)
  await queryInterface.addColumn('IndexingRules', 'autoRenewal', {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  })
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  return await queryInterface.sequelize.transaction({}, async transaction => {
    const tables = await queryInterface.showAllTables()

    if (tables.includes('IndexingRules')) {
      logger.info(`Remove 'autoRenewal' column`)
      await context.queryInterface.removeColumn(
        'IndexingRules',
        'autoRenewal',
        { transaction },
      )
    }
  })
}
