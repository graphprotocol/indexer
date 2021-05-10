import { Logger } from '@graphprotocol/common-ts'
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
  if (tables.includes('receipts')) {
    await queryInterface.renameTable('receipts', 'transfer_receipts')
  }
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context
  logger.info(`Rename 'transfer_receipts' table to 'receipts'`)
  await queryInterface.renameTable('transfer_receipts', 'receipts')
}
