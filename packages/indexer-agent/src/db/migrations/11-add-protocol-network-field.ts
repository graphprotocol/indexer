import { Logger } from '@graphprotocol/common-ts'
import { DataTypes, QueryInterface } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
  networkChainId: string
}

interface Context {
  context: MigrationContext
}

const IndexingRules = 'IndexingRules'
const Actions = 'Actions'
const protocolNetwork = 'protocolNetwork'
const oldPrimaryKeyConstraint = 'IndexingRules_pkey' // Assuming this is the existing constraint name
const newPrimaryKeyConstraint = 'IndexingRules_composite_pkey'

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, networkChainId, logger } = context

  // Add protocolNetwork columns
  await addColumn(Actions, protocolNetwork, queryInterface, logger)
  await addColumn(IndexingRules, protocolNetwork, queryInterface, logger)

  // Update and relax constraints for the IndexingRules table
  logger.info(
    `Temporarily removing primary key constraints from ${IndexingRules}`,
  )
  await queryInterface.removeConstraint(IndexingRules, oldPrimaryKeyConstraint)

  // Populate the `protocolNetwork` columns with the provided network ID
  await updateTable(
    IndexingRules,
    protocolNetwork,
    networkChainId,
    queryInterface,
    logger,
  )
  await updateTable(
    Actions,
    protocolNetwork,
    networkChainId,
    queryInterface,
    logger,
  )

  // Restore constraints for the IndexingRules table
  logger.info(`Restoring primary key constraints from ${IndexingRules}`)
  await queryInterface.addConstraint(IndexingRules, {
    fields: ['identifier', protocolNetwork],
    type: 'primary key',
    name: newPrimaryKeyConstraint,
  })

  // Alter the `protocolNetwork` columns to be NOT NULL
  await alterColumn(IndexingRules, protocolNetwork, queryInterface, logger)
  await alterColumn(Actions, protocolNetwork, queryInterface, logger)
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context
  // Drop the new primary key constraint
  await queryInterface.removeConstraint(IndexingRules, newPrimaryKeyConstraint)

  // Drop the new columns
  await dropColumn(IndexingRules, protocolNetwork, queryInterface, logger)
  await dropColumn(Actions, protocolNetwork, queryInterface, logger)

  // Restore the old primary key constraint
  await queryInterface.addConstraint(IndexingRules, {
    fields: ['identifier'],
    type: 'primary key',
    name: oldPrimaryKeyConstraint,
  })
}

/* Helper functions */

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

async function updateTable(
  tableName: string,
  columnName: string,
  value: string,
  queryInterface: QueryInterface,
  logger: Logger,
) {
  const values = { [columnName]: value }
  const where = { [columnName]: null }
  logger.info(`Set '${tableName}' table '${columnName}' column to '${value}'`)
  await queryInterface.bulkUpdate(tableName, values, where)
}

async function alterColumn(
  tableName: string,
  columnName: string,
  queryInterface: QueryInterface,
  logger: Logger,
) {
  logger.info(`Altering ${tableName} table ${columnName} to be non-nullable`)
  await queryInterface.changeColumn(tableName, columnName, {
    type: DataTypes.STRING,
    allowNull: true,
  })
}
