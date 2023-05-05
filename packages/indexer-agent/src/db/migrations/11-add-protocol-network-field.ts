import { Logger } from '@graphprotocol/common-ts'
import { DataTypes, QueryInterface } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}

const IndexingRules = 'IndexingRules'
const Actions = 'Actions'
const protocolNetwork = 'protocolNetwork'
const oldPrimaryKey = 'IndexingRules_pkey'
const newPrimaryKey = 'IndexingRules_composite_pkey'

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  // Add protocolNetwork column
  await addColumn(Actions, protocolNetwork, queryInterface, logger)
  await addColumn(IndexingRules, protocolNetwork, queryInterface, logger)

  // Update constraints for the IndexingRules table
  await queryInterface.removeConstraint(IndexingRules, oldPrimaryKey)

  logger.fatal(
    // TODO
    'TODO: SET protocolNetwork column to the signle currently used network CAIP-2 identifier',
  )
  process.exit(1)

  await queryInterface.addConstraint(IndexingRules, {
    fields: ['identifier', protocolNetwork],
    type: 'primary key',
    name: newPrimaryKey,
  })
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context
  // Restore Primary Key
  await queryInterface.removeConstraint(IndexingRules, newPrimaryKey)
  await queryInterface.addConstraint(IndexingRules, {
    fields: ['identifier'],
    type: 'primary key',
    name: oldPrimaryKey,
  })

  await dropColumn(IndexingRules, protocolNetwork, queryInterface, logger)
  await dropColumn(Actions, protocolNetwork, queryInterface, logger)
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
