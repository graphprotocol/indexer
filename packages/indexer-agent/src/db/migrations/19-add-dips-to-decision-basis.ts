import type { Logger } from '@graphprotocol/common-ts'
import type { QueryInterface } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.debug('Adding dips to decision basis')

  await queryInterface.sequelize.query(
    `ALTER TYPE "enum_IndexingRules_decisionBasis" ADD VALUE 'dips'`,
  )

  logger.info('Migration completed')
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.info('Removing dips from decision basis')
  await queryInterface.sequelize.query(
    `ALTER TYPE "enum_IndexingRules_decisionBasis" DROP VALUE 'dips'`,
  )

  logger.info('Migration completed')
}
