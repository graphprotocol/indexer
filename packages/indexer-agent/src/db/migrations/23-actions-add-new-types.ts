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
  const typeColumn = table.type
  if (typeColumn) {
    logger.debug(`'type' column exists with type = ${typeColumn.type}`)
    logger.info(
      `Update 'type' column to support 'presentPOI' and 'resize' types`,
    )
    await queryInterface.changeColumn('Actions', 'type', {
      type: DataTypes.ENUM(
        'allocate',
        'unallocate',
        'reallocate',
        'presentPOI',
        'resize',
      ),
      allowNull: false,
    })
    return
  }
}

export async function down({ context }: Context): Promise<void> {
  const { logger } = context
  logger.info(
    `No 'down' migration needed since the 'up' migration simply added new types 'presentPOI' and 'resize'`,
  )
  return
}
