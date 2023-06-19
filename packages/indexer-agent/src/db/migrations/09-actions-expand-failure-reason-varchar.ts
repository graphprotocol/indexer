import { Logger } from '@tokene-q/common-ts'
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
  const failureReason = table.failureReason
  if (failureReason) {
    logger.debug(
      `'failureReason' columns exists with type = ${failureReason.type}`,
    )
    logger.info(
      `Update 'failureReason' column to support large strings (up to length = 5000)`,
    )
    await queryInterface.changeColumn(
      'Actions',
      'failureReason',
      DataTypes.STRING(5000),
    )
    return
  }
}

export async function down({ context }: Context): Promise<void> {
  const { logger } = context
  logger.info(
    `No 'down' migration needed since the 'up' migration simply expanded the 'failureReason' column size`,
  )
  return
}
