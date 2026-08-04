import type { Logger } from '@graphprotocol/common-ts'
import { type QueryInterface } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}

const LEGACY_TABLES = [
  'scalar_tap_rav_requests_failed',
  'scalar_tap_ravs',
  'scalar_tap_receipts_invalid',
  'scalar_tap_receipts',
  'scalar_tap_denylist',
] as const

const LEGACY_FUNCTIONS = [
  'scalar_tap_receipt_notify',
  'scalar_tap_deny_notify',
] as const

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context
  const tables = await queryInterface.showAllTables()

  for (const table of LEGACY_TABLES) {
    if (tables.includes(table)) {
      logger.info(`Dropping legacy TAP table: ${table}`)
      await queryInterface.dropTable(table)
    } else {
      logger.debug(`Table ${table} does not exist; skipping`)
    }
  }

  for (const fn of LEGACY_FUNCTIONS) {
    logger.info(`Dropping legacy TAP function: ${fn}`)
    await queryInterface.sequelize.query(`DROP FUNCTION IF EXISTS ${fn}()`)
  }
}

export async function down(): Promise<void> {
  throw new Error('migration 25-drop-legacy-tap-tables is not reversible')
}
