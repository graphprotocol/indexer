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
  const publicPOI = table.publicPOI
  const poiBlockNumber = table.poiBlockNumber
  if (publicPOI && poiBlockNumber) {
    logger.info(`'publicPOI' and 'poiBlockNumber' columns already exist, migration not necessary`)
    return
  }

  logger.info(`Add 'publicPOI' and 'poiBlockNumber' columns to 'Actions' table`)
  await queryInterface.addColumn('Actions', 'publicPOI', {
    type: DataTypes.STRING,
    allowNull: true,
  })
  await queryInterface.addColumn('Actions', 'poiBlockNumber', {
    type: DataTypes.INTEGER,
    allowNull: true,
  })
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  return await queryInterface.sequelize.transaction({}, async transaction => {
    const tables = await queryInterface.showAllTables()

    if (tables.includes('Actions')) {
      logger.info(`Remove 'publicPOI' and 'poiBlockNumber' columns`)
      await context.queryInterface.removeColumn('Actions', 'publicPOI', {
        transaction,
      })
      await context.queryInterface.removeColumn('Actions', 'poiBlockNumber', {
        transaction,
      })
    }
  })
}
