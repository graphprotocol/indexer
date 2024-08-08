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
    `Modifying tables scalar_Tap_Ravs, scalar_tap_receipts and scalar_tap_receipts_invalid with correct value types`,
  )

  if (tables.includes('scalar_tap_ravs')) {
    await queryInterface.changeColumn('scalar_tap_ravs', 'value_aggregate', {
      type: DataTypes.DECIMAL(39),
      allowNull: false,
    })
  }
  if (tables.includes('scalar_tap_receipts')) {
    await queryInterface.changeColumn('scalar_tap_receipts', 'nonce', {
      type: DataTypes.DECIMAL(20),
      allowNull: false,
    })
  }

  if (tables.includes('scalar_tap_receipts_invalid')) {
    await queryInterface.changeColumn('scalar_tap_receipts_invalid', 'nonce', {
      type: DataTypes.DECIMAL(20),
      allowNull: false,
    })
  }
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context
  // Drop the scalar_tap_ravs table
  logger.info(`Drop table`)
  await queryInterface.dropTable('scalar_tap_ravs')

  logger.info(`Drop function, trigger, indices, and table`)
  await queryInterface.sequelize.query(
    'DROP TRIGGER IF EXISTS receipt_update ON scalar_tap_receipts',
  )
  await queryInterface.sequelize.query(
    'DROP FUNCTION IF EXISTS scalar_tap_receipt_notify',
  )
  await queryInterface.removeIndex(
    'scalar_tap_receipts',
    'scalar_tap_receipts_allocation_id_idx',
  )
  await queryInterface.removeIndex(
    'scalar_tap_receipts',
    'scalar_tap_receipts_timestamp_ns_idx',
  )
  await queryInterface.dropTable('scalar_tap_receipts')
}
