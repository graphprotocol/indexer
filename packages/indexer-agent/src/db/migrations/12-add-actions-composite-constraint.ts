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

  logger.info('Adding composite unique constraint to Actions table')
  // Add the new composite primary key
  await queryInterface.addConstraint('Actions', {
    fields: ['deploymentID', 'source'],
    type: 'unique',
    name: 'Actions_ckey_unique_deploymentID_source',
  })
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context
  logger.info('Removing composite uniqie constraint from Actions table')
  await queryInterface.removeConstraint(
    'Actions',
    'Actions_ckey_unique_deploymentID_source',
  )
}
