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

  logger.info(`Rename fee columns`)

  return await queryInterface.sequelize.transaction({}, async transaction => {
    const tables = await queryInterface.showAllTables()

    if (tables.includes('allocation_receipts')) {
      await queryInterface.renameColumn(
        'allocation_receipts',
        'paymentAmount',
        'fees',
        { transaction },
      )
    }

    if (tables.includes('allocation_summaries')) {
      await queryInterface.renameColumn(
        'allocation_summaries',
        'queryFees',
        'collectedFees',
        { transaction },
      )
    }

    if (tables.includes('transfer_receipts')) {
      await queryInterface.renameColumn(
        'transfer_receipts',
        'paymentAmount',
        'fees',
        { transaction },
      )
    }
  })
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.info(`Revert renaming fee columns`)

  return await queryInterface.sequelize.transaction({}, async transaction => {
    const tables = await queryInterface.showAllTables()

    if (tables.includes('allocation_receipts')) {
      await queryInterface.renameColumn(
        'allocation_receipts',
        'fees',
        'paymentAmount',
        { transaction },
      )
    }
    if (tables.includes('allocation_summaries')) {
      await queryInterface.renameColumn(
        'allocation_summaries',
        'collectedFees',
        'queryFees',
        { transaction },
      )
    }
    if (tables.includes('transfer_receipts')) {
      await queryInterface.renameColumn(
        'transfer_receipts',
        'fees',
        'paymentAmount',
        { transaction },
      )
    }
  })
}
