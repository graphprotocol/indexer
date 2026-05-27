import { Logger } from '@graphprotocol/common-ts'
import { QueryInterface } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}

const INDEX_NAME = 'tap_horizon_receipts_collection_id'
const INDEX_NAME_TEXT = 'tap_horizon_receipts_collection_text_id'

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.info(`Creating composite index ${INDEX_NAME} on tap_horizon_receipts`)
  await queryInterface.addIndex(
    'tap_horizon_receipts',
    ['collection_id', 'id'],
    {
      name: INDEX_NAME,
      concurrently: true,
    },
  )
  logger.info(`Created index ${INDEX_NAME}`)

  // This index can be removed if the indexer is running indexer-service v2.1.1
  // TODO: once there is sufficient indexer coverage remove it
  logger.info(
    `Creating composite index ${INDEX_NAME_TEXT} on tap_horizon_receipts`,
  )
  await queryInterface.sequelize.query(`
    CREATE INDEX CONCURRENTLY ${INDEX_NAME_TEXT}
    ON tap_horizon_receipts (CAST(collection_id AS TEXT), id)
  `)
  logger.info(`Created index ${INDEX_NAME_TEXT}`)
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.info(`Dropping index ${INDEX_NAME}`)
  await queryInterface.removeIndex('tap_horizon_receipts', INDEX_NAME)

  logger.info(`Dropping index ${INDEX_NAME_TEXT}`)
  await queryInterface.removeIndex('tap_horizon_receipts', INDEX_NAME_TEXT)
}
