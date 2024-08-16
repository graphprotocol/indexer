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

  const tables = await queryInterface.showAllTables()
  logger.debug(
    `Modifying tables scalar_tap_receipts_invalid to add extra column`,
  )

  if (tables.includes('scalar_tap_receipts_invalid')) {
    await queryInterface.addColumn('scalar_tap_receipts_invalid', 'error_log', {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '',
    })
  }
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context
  logger.info(`Drop function, trigger, indices, and table`)
  queryInterface.removeColumn('scalar_tap_receipts_invalid', 'error_log')
}
