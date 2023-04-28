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
  await addColumn('IndexingRules', 'protocolNetwork', queryInterface, logger)
  await addColumn('Action', 'protocolNetwork', queryInterface, logger)
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context
  await dropColumn('IndexingRules', 'protocolNetwork', queryInterface, logger)
  await dropColumn('Action', 'protocolNetwork', queryInterface, logger)
}

async function addColumn(
  tableName: string,
  columnName: string,
  queryInterface: QueryInterface,
  logger: Logger,
): Promise<void> {
  logger.debug(`Checking if ${tableName} table exists`)
  const tables = await queryInterface.showAllTables()
  if (!tables.includes(tableName)) {
    logger.info(`${tableName} table does not exist, migration not necessary`)
    return
  }

  logger.debug(`Checking if ${tableName} table needs to be migrated`)
  const table = await queryInterface.describeTable(tableName)
  if (columnName in table) {
    logger.info(
      `'${columnName}' columns already exist, migration not necessary`,
    )
    return
  }

  logger.info(`Add '${columnName}' column to ${tableName} table`)
  await queryInterface.addColumn(tableName, columnName, {
    type: DataTypes.STRING,
    allowNull: true,
  })
}

async function dropColumn(
  tableName: string,
  columnName: string,
  queryInterface: QueryInterface,
  logger: Logger,
): Promise<void> {
  const tables = await queryInterface.showAllTables()
  if (tables.includes(tableName)) {
    logger.info(`Drop '${columnName}' column from ${tableName} table`)
    await queryInterface.removeColumn(tableName, columnName)
  }
}
