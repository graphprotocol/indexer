import { Logger } from '@tokene-q/common-ts'
import { DataTypes, QueryInterface } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}

export async function up({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.debug(`Checking if indexing rules table exists`)
  const tables = await queryInterface.showAllTables()
  if (!tables.includes('IndexingRules')) {
    logger.info(`Indexing rules table does not exist, migration not necessary`)
    return
  }

  logger.debug(`Checking if 'IndexingRules' table needs to be migrated`)
  const table = await queryInterface.describeTable('IndexingRules')
  const subgraphIdentifierTypeColumn = table.identifierType
  const subgraphIdentifierColumn = table.identifier
  if (subgraphIdentifierTypeColumn && subgraphIdentifierColumn) {
    logger.info(
      `'identifier' and 'identifierType' columns already exist, migration not necessary`,
    )
    return
  }

  logger.info(`Add 'identifierType' column to 'IndexingRules' table`)
  await queryInterface.addColumn('IndexingRules', 'identifierType', {
    type: DataTypes.ENUM('deployment', 'subgraph', 'group'),
    primaryKey: true,
    defaultValue: 'deployment',
  })

  logger.info(`Rename 'deployment' column to 'identifier'`)
  await queryInterface.renameColumn('IndexingRules', 'deployment', 'identifier')

  logger.info(`Update identifierType value for existing rules`)
  await queryInterface.sequelize.query(
    `update  "IndexingRules" set "identifierType" = 'group' where "identifier" = 'global'`,
  )
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  return await queryInterface.sequelize.transaction({}, async transaction => {
    const tables = await queryInterface.showAllTables()

    if (tables.includes('IndexingRules')) {
      logger.info(`Remove 'identifierType' column`)
      await context.queryInterface.removeColumn(
        'IndexingRules',
        'identifierType',
        { transaction },
      )

      logger.info(`Rename 'identifier' column back to 'deployment'`)
      await queryInterface.renameColumn(
        'IndexingRules',
        'identifier',
        'deployment',
        { transaction },
      )

      logger.info(`Remove 'enum_IndexingRules_identifierType' custom type`)
      await queryInterface.sequelize.query(
        `delete  from pg_type where typname = 'enum_IndexingRules_identifierType'`,
      )
    }
  })
}
