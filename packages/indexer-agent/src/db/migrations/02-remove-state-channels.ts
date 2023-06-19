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

  logger.info(`Remove old state channels from the database`)

  const tables = [
    'app_bytecode',
    'channels',
    'funding',
    'knex_migrations',
    'knex_migrations_lock',
    'ledger_requests',
    'nonces',
    'objectives',
    'objectives_channels',
    'signing_wallets',
  ]

  for (const table of tables) {
    try {
      await queryInterface.dropTable(table, { cascade: true })
    } catch (err) {
      logger.warn(
        'Failed to remove old state channels table from the database',
        {
          err,
          table,
        },
      )
    }
  }
}

export async function down(): Promise<void> {
  // Nothing to do here
}
