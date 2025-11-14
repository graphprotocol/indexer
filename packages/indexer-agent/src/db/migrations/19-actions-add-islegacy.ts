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

  logger.debug(`Checking if 'Actions' table exists`)
  const tables = await queryInterface.showAllTables()
  if (!tables.includes('Actions')) {
    logger.info(`Actions table does not exist, migration not necessary`)
    return
  }

  logger.debug(`Checking if 'Actions' table needs to be migrated`)
  const table = await queryInterface.describeTable('Actions')
  const isLegacy = table.isLegacy
  if (isLegacy) {
    logger.info(`'isLegacy' column already exists, migration not necessary`)
    return
  }

  logger.info(`Add 'isLegacy' column to 'Actions' table`)
  await queryInterface.addColumn('Actions', 'isLegacy', {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  })
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  return await queryInterface.sequelize.transaction({}, async transaction => {
    const tables = await queryInterface.showAllTables()

    if (tables.includes('Actions')) {
      logger.info(`Remove 'isLegacy' column`)
      await context.queryInterface.removeColumn('Actions', 'isLegacy', {
        transaction,
      })
    }
  })
}
