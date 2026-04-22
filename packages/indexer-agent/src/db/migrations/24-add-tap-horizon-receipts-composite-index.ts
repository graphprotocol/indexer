import { Logger } from '@graphprotocol/common-ts'
import { QueryInterface } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}

const INDEX_NAME = 'tap_horizon_receipts_aggregation_idx'

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.info(`Creating composite index ${INDEX_NAME} on tap_horizon_receipts`)
  await queryInterface.addIndex(
    'tap_horizon_receipts',
    [
      'collection_id',
      'service_provider',
      'payer',
      'data_service',
      'signer_address',
      'timestamp_ns',
    ],
    {
      name: INDEX_NAME,
      concurrently: true,
    },
  )
  logger.info(`Created index ${INDEX_NAME}`)
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.info(`Dropping index ${INDEX_NAME}`)
  await queryInterface.removeIndex('tap_horizon_receipts', INDEX_NAME)
}
