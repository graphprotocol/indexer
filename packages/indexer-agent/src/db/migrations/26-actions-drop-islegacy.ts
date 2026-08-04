import type { Logger } from '@graphprotocol/common-ts'
import { type QueryInterface } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  if (!(await queryInterface.tableExists('Actions'))) {
    logger.debug('Actions table does not exist; skipping isLegacy column drop')
    return
  }

  const columns = await queryInterface.describeTable('Actions')
  if (!('isLegacy' in columns)) {
    logger.debug('Actions.isLegacy column does not exist; skipping')
    return
  }

  logger.info('Dropping Actions.isLegacy column')
  await queryInterface.removeColumn('Actions', 'isLegacy')
}

export async function down(): Promise<void> {
  throw new Error('migration 26-actions-drop-islegacy is not reversible')
}
