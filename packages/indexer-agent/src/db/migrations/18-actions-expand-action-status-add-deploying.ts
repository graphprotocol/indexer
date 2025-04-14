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
  const statusColumn = table.status
  if (statusColumn) {
    logger.debug(`'status' column exists with type = ${statusColumn.type}`)
    logger.info(`Update 'status' column to support variant 'deploying' status`)
    await queryInterface.changeColumn('Actions', 'status', {
      type: DataTypes.ENUM(
        'queued',
        'approved',
        'deploying',
        'pending',
        'success',
        'failed',
        'canceled',
      ),
      allowNull: false,
    })
    return
  }
}

export async function down({ context }: Context): Promise<void> {
  const { logger } = context
  logger.info(
    `No 'down' migration needed since the 'up' migration simply added a new status 'deploying'`,
  )
  return
}
