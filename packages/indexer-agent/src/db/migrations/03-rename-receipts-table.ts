import { Logger } from '@tokene-q/common-ts'
import { QueryInterface } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.info(`Rename 'receipts' table to 'transfer_receipts'`)

  const tables = await queryInterface.showAllTables()

  // If we already have the transfer_receipts table, just drop the receipts
  if (tables.includes('transfer_receipts')) {
    await queryInterface.dropTable('receipts')
  } else {
    // Otherwise rename the table to transfer_receipts
    if (tables.includes('receipts')) {
      await queryInterface.renameTable('receipts', 'transfer_receipts')
    }
  }
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context
  logger.info(`Rename 'transfer_receipts' table to 'receipts'`)
  const tables = await queryInterface.showAllTables()

  // If we already have a receipts table, just drop transfer_receipts
  if (tables.includes('receipts')) {
    await queryInterface.dropTable('transfer_receipts')
  } else {
    // Otherwise rename the table to receipts
    if (tables.includes('transfer_receipts')) {
      await queryInterface.renameTable('transfer_receipts', 'receipts')
    }
  }
}
