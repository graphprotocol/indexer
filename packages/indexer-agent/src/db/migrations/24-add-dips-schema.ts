import type { Logger } from '@graphprotocol/common-ts'
import { DataTypes, type QueryInterface } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  // 1. Add 'dips' to the IndexingRules.decisionBasis enum.
  // Skipped on fresh DBs — sequelize.sync() will create the enum already
  // including 'dips' from the model definition. Existing prod DBs need this
  // ALTER to add the value to a pre-existing enum type.
  if (await queryInterface.tableExists('IndexingRules')) {
    logger.info(`Adding 'dips' to enum_IndexingRules_decisionBasis`)
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_IndexingRules_decisionBasis" ADD VALUE 'dips'`,
    )
  } else {
    logger.debug(
      'IndexingRules table does not exist; skipping decisionBasis enum migration',
    )
  }

  // 2. Create pending_rca_proposals table.
  const tables = await queryInterface.showAllTables()
  if (tables.includes('pending_rca_proposals')) {
    logger.debug('pending_rca_proposals already exists; skipping table creation')
    return
  }

  logger.info('Creating pending_rca_proposals')
  await queryInterface.createTable('pending_rca_proposals', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    signed_payload: {
      type: DataTypes.BLOB,
      allowNull: false,
    },
    version: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      defaultValue: 2,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  })

  await queryInterface.addIndex(
    'pending_rca_proposals',
    ['status', 'created_at'],
    { name: 'idx_pending_rca_status' },
  )
  await queryInterface.addIndex('pending_rca_proposals', {
    fields: [{ name: 'created_at', order: 'DESC' }],
    name: 'idx_pending_rca_created',
  })
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.info('Dropping pending_rca_proposals')
  await queryInterface.dropTable('pending_rca_proposals')

  logger.info(`Removing 'dips' from enum_IndexingRules_decisionBasis`)
  await queryInterface.sequelize.query(
    `ALTER TYPE "enum_IndexingRules_decisionBasis" DROP VALUE 'dips'`,
  )
}
