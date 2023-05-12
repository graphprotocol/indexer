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
const POIDispute = 'POIDispute'
const protocolNetwork = 'protocolNetwork'
const IndexingRulesOldPrimaryKeyConstraint = 'IndexingRules_pkey' // Assuming this is the existing constraint name
const IndexingRulesNewPrimaryKeyConstraint = 'IndexingRules_composite_pkey'
const IndexingRulesOldPrimaryKeyColumn = 'identifier'
const POIDisputeOldPrimaryKeyConstraint = 'POIDispute_pkey' // Assuming this is the existing constraint name
const POIDisputeNewPrimaryKeyConstraint = 'POIDispute_composite_pkey'
const POIDisputeOldPrimaryKeyColumn = 'allocationID'

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, networkChainId, logger } = context
  const m = new Migration(queryInterface, logger)

  // Add protocolNetwork columns
  await m.addColumn(Actions, protocolNetwork)
  await m.addColumn(IndexingRules, protocolNetwork)
  await m.addColumn(POIDispute, protocolNetwork)

  // Update and relax constraints
  await m.removeConstraint(IndexingRules, IndexingRulesOldPrimaryKeyConstraint)
  await m.removeConstraint(POIDispute, POIDisputeOldPrimaryKeyConstraint)

  // Populate the `protocolNetwork` columns with the provided network ID
  await m.updateTable(IndexingRules, protocolNetwork, networkChainId)
  await m.updateTable(Actions, protocolNetwork, networkChainId)
  await m.updateTable(POIDispute, protocolNetwork, networkChainId)

  // Restore constraints
  await m.restorePrimaryKeyConstraint(
    IndexingRules,
    IndexingRulesNewPrimaryKeyConstraint,
    [IndexingRulesOldPrimaryKeyColumn, protocolNetwork],
  )
  await m.restorePrimaryKeyConstraint(
    POIDispute,
    POIDisputeNewPrimaryKeyConstraint,
    [POIDisputeOldPrimaryKeyColumn, protocolNetwork],
  )

  // Alter the `protocolNetwork` columns to be NOT NULL
  await m.alterColumn(IndexingRules, protocolNetwork)
  await m.alterColumn(Actions, protocolNetwork)
  await m.alterColumn(POIDispute, protocolNetwork)
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context
  const m = new Migration(queryInterface, logger)

  // Drop the new primary key constraint
  await queryInterface.removeConstraint(
    IndexingRules,
    IndexingRulesNewPrimaryKeyConstraint,
  )
  await queryInterface.removeConstraint(
    POIDispute,
    POIDisputeNewPrimaryKeyConstraint,
  )

  // Drop the new columns
  await m.dropColumn(IndexingRules, protocolNetwork)
  await m.dropColumn(Actions, protocolNetwork)
  await m.dropColumn(POIDispute, protocolNetwork)

  // Restore the old primary key constraint
  await queryInterface.addConstraint(IndexingRules, {
    fields: [IndexingRulesOldPrimaryKeyColumn],
    type: 'primary key',
    name: IndexingRulesOldPrimaryKeyConstraint,
  })
  await queryInterface.addConstraint(IndexingRules, {
    fields: [POIDisputeOldPrimaryKeyColumn],
    type: 'primary key',
    name: POIDisputeOldPrimaryKeyConstraint,
  })
}

// Helper migration class
class Migration {
  queryInterface: QueryInterface
  logger: Logger
  constructor(queryInterface: QueryInterface, logger: Logger) {
    this.queryInterface = queryInterface
    this.logger = logger
  }

  async addColumn(tableName: string, columnName: string): Promise<void> {
    this.logger.debug(`Checking if ${tableName} table exists`)
    const tables = await this.queryInterface.showAllTables()
    if (!tables.includes(tableName)) {
      this.logger.info(
        `${tableName} table does not exist, migration not necessary`,
      )
      return
    }

    this.logger.debug(`Checking if ${tableName} table needs to be migrated`)
    const table = await this.queryInterface.describeTable(tableName)
    if (columnName in table) {
      this.logger.info(
        `'${columnName}' columns already exist, migration not necessary`,
      )
      return
    }

    this.logger.info(`Add '${columnName}' column to ${tableName} table`)
    await this.queryInterface.addColumn(tableName, columnName, {
      type: DataTypes.STRING,
      allowNull: true,
    })
  }

  async dropColumn(tableName: string, columnName: string): Promise<void> {
    const tables = await this.queryInterface.showAllTables()
    if (tables.includes(tableName)) {
      this.logger.info(`Drop '${columnName}' column from ${tableName} table`)
      await this.queryInterface.removeColumn(tableName, columnName)
    }
  }

  async updateTable(tableName: string, columnName: string, value: string) {
    const values = { [columnName]: value }
    const where = { [columnName]: null }
    this.logger.info(
      `Set '${tableName}' table '${columnName}' column to '${value}'`,
    )
    await this.queryInterface.bulkUpdate(tableName, values, where)
  }

  async alterColumn(tableName: string, columnName: string) {
    this.logger.info(
      `Altering ${tableName} table ${columnName} to be non-nullable`,
    )
    await this.queryInterface.changeColumn(tableName, columnName, {
      type: DataTypes.STRING,
      allowNull: true,
    })
  }

  async removeConstraint(tableName: string, constraintName: string) {
    this.logger.info(
      `Temporarily removing primary key constraints from ${tableName}`,
    )
    await this.queryInterface.removeConstraint(tableName, constraintName)
  }

  async restorePrimaryKeyConstraint(
    tableName: string,
    newConstraintName: string,
    columns: string[],
  ) {
    this.logger.info(`Restoring primary key constraints from ${tableName}`)
    await this.queryInterface.addConstraint(tableName, {
      fields: columns,
      type: 'primary key',
      name: newConstraintName,
    })
  }
}
