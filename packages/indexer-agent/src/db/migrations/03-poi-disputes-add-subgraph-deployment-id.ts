import { Logger } from '@graphprotocol/common-ts'
import { QueryInterface, DataTypes } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.info(`Checking if POI disputes table exists`)
  const tables = await queryInterface.showAllTables()
  if (!tables.includes('POIDisputes')) {
    logger.info(`POI disputes table does not exist, migration not necessary`)
    return
  }

  logger.info(`Checking if POI disputes table needs to be migrated`)
  const table = await queryInterface.describeTable('POIDisputes')
  const subgraphDeploymentIDColumn = table.subgraphDeploymentID
  if (subgraphDeploymentIDColumn) {
    logger.info(
      `Subgraph deployment ID column already exists, migration not necessary`,
    )
    return
  }

  logger.info(`Adding subgraphDeploymentID column to POIDisputes table`)
  await queryInterface.addColumn('POIDisputes', 'subgraphDeploymentID', {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'notSet',
  })
}

export async function down({ context }: Context): Promise<void> {
  await context.queryInterface.removeColumn(
    'POIDisputes',
    'subgraphDeploymentID',
  )
}
