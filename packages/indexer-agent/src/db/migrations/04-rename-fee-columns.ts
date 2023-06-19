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

  logger.info(`Rename fee columns`)

  return await queryInterface.sequelize.transaction({}, async transaction => {
    const tables = await queryInterface.showAllTables()

    if (tables.includes('allocation_receipts')) {
      const table = await queryInterface.describeTable('allocation_receipts')
      if (table.paymentAmount) {
        await queryInterface.renameColumn(
          'allocation_receipts',
          'paymentAmount',
          'fees',
          { transaction },
        )
      } else if (table.fees) {
        logger.info(
          `Fees column already exists in the allocation_receipts table, column rename not necessary`,
        )
      }
    }

    if (tables.includes('allocation_summaries')) {
      const table = await queryInterface.describeTable('allocation_summaries')
      if (table.queryFees) {
        await queryInterface.renameColumn(
          'allocation_summaries',
          'queryFees',
          'collectedFees',
          { transaction },
        )
      } else if (table.collectedFees)
        logger.info(
          `collectedFees column already exists in the allocation_receipts table, column rename not necessary`,
        )
      return
    }

    if (tables.includes('transfer_receipts')) {
      const table = await queryInterface.describeTable('transfer_receipts')
      if (table.paymentAmount) {
        await queryInterface.renameColumn(
          'transfer_receipts',
          'paymentAmount',
          'fees',
          { transaction },
        )
      } else if (table.fees) {
        logger.info(
          `fees column already exists in the transfer_receipts table, column rename not necessary`,
        )
      }
    }
  })
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.info(`Revert renaming fee columns`)

  return await queryInterface.sequelize.transaction({}, async transaction => {
    const tables = await queryInterface.showAllTables()

    if (tables.includes('allocation_receipts')) {
      const table = await queryInterface.describeTable('allocation_receipts')
      if (table.fees) {
        await queryInterface.renameColumn(
          'allocation_receipts',
          'fees',
          'paymentAmount',
          { transaction },
        )
      } else if (table.paymentAmount) {
        logger.info(
          `paymentAmount column already exists in the allocation_receipts table, column rename not necessary`,
        )
      }
    }

    if (tables.includes('allocation_summaries')) {
      const table = await queryInterface.describeTable('allocation_summaries')
      if (table.collectedFees) {
        await queryInterface.renameColumn(
          'allocation_summaries',
          'collectedFees',
          'queryFees',
          { transaction },
        )
      } else if (table.queryFees)
        logger.info(
          `queryFees column already exists in the allocation_receipts table, column rename not necessary`,
        )
      return
    }

    if (tables.includes('transfer_receipts')) {
      const table = await queryInterface.describeTable('transfer_receipts')
      if (table.fees) {
        await queryInterface.renameColumn(
          'transfer_receipts',
          'fees',
          'paymentAmount',
          { transaction },
        )
      } else if (table.paymentAmount) {
        logger.info(
          `paymentAmount column already exists in the transfer_receipts table, column rename not necessary`,
        )
      }
    }
  })
}
