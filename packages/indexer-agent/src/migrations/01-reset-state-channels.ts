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

  logger.info(`Reset state channels in the database`)
  const tablesToTruncate = [
    'signing_wallets',
    'objectives',
    'nonces',
    'app_bytecode',
  ]

  const tables = await queryInterface.showAllTables()

  for (const table of tablesToTruncate) {
    if (!tables.includes(table)) {
      logger.info(`Skipping non-existent table ${table}`)
    } else {
      try {
        await queryInterface.sequelize.query(`TRUNCATE TABLE ${table} CASCADE`)
      } catch (err) {
        logger.warn(`Failed to reset table`, { table, err })
      }
    }
  }
}

export async function down(): Promise<void> {
  // Nothing to do here
}
