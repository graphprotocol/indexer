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

  logger.debug(`Checking if actions table exists`)
  const tables = await queryInterface.showAllTables()
  if (!tables.includes('Actions')) {
    logger.info(`Actions table does not exist, migration not necessary`)
    return
  }

  logger.debug(`Checking if 'Actions' table needs to be migrated`)
  const table = await queryInterface.describeTable('Actions')
  const syncingNetworkColumn = table.syncingNetwork
  if (syncingNetworkColumn) {
    logger.info(
      `'syncingNetwork' columns already exist, migration not necessary`,
    )
    return
  }

  logger.info(`Add 'syncingNetwork' column to 'Actions' table`)
  await queryInterface.addColumn('Actions', 'syncingNetwork', {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  })
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  return await queryInterface.sequelize.transaction({}, async transaction => {
    const tables = await queryInterface.showAllTables()

    if (tables.includes('Actions')) {
      logger.info(`Remove 'syncingNetwork' column`)
      await context.queryInterface.removeColumn('Actions', 'syncingNetwork', {
        transaction,
      })
    }
  })
}
