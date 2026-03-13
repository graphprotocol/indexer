import { Logger } from '@graphprotocol/common-ts'

import { QueryInterface, DataTypes } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  const tables = await queryInterface.showAllTables()
  logger.debug('Checking if pending_rca_proposals table exists', { tables })

  if (tables.includes('pending_rca_proposals')) {
    logger.debug(
      'pending_rca_proposals already exists, migration not necessary',
    )
    return
  }

  logger.info('Create pending_rca_proposals')
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
    {
      name: 'idx_pending_rca_status',
    },
  )
  await queryInterface.addIndex('pending_rca_proposals', {
    fields: [{ name: 'created_at', order: 'DESC' }],
    name: 'idx_pending_rca_created',
  })
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context
  logger.info('Drop pending_rca_proposals')
  await queryInterface.dropTable('pending_rca_proposals')
}
