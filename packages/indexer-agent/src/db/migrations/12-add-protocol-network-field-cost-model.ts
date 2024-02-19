import { Logger } from '@graphprotocol/common-ts'
import { caip2IdRegex } from '@graphprotocol/indexer-common'
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

  logger.debug(`Checking if 'CostModel' table exists`)
  const tables = await queryInterface.showAllTables()
  if (!tables.includes('CostModel')) {
    logger.info(`Indexing rules table does not exist, migration not necessary`)
    return
  }

  logger.debug(`Checking if 'CostModel' table needs to be migrated`)
  const table = await queryInterface.describeTable('CostModel')
  const protocolNetwork = table.protocolNetwork
  if (protocolNetwork) {
    logger.info(
      `'protocolNetwork' column already exist, migration not necessary`,
    )
    return
  }

  logger.info(`Add 'protocolNetwork' column to 'CostModel' table`)
  await queryInterface.addColumn('CostModel', 'protocolNetwork', {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      is: caip2IdRegex,
    },
  })
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  return await queryInterface.sequelize.transaction({}, async transaction => {
    const tables = await queryInterface.showAllTables()

    if (tables.includes('CostModel')) {
      logger.info(`Remove 'protocolNetwork' column`)
      await context.queryInterface.removeColumn(
        'CostModel',
        'protocolNetwork',
        {
          transaction,
        },
      )
    }
  })
}
