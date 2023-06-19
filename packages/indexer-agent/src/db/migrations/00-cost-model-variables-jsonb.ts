import { Logger } from '@tokene-q/common-ts'
import { indexerError, IndexerErrorCode } from '@graphprotocol/indexer-common'
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

  logger.info(`Checking if cost models table exists`)
  const tables = await queryInterface.showAllTables()
  if (!tables.includes('CostModels')) {
    logger.info(`Cost models table does not exist, migration not necessary`)
    return
  }

  logger.info(`Checking if cost models table needs to be migrated`)
  const table = await queryInterface.describeTable('CostModels')
  const variablesColumn = table.variables
  if (!variablesColumn) {
    logger.info(`Variables column no longer exists, migration not necessary`)
    return
  }
  if (variablesColumn.type === 'JSONB') {
    logger.info(`Variables column is already JSONB, migration not necessary`)
    return
  }

  // Load all cost models in memory
  logger.info(`Loading cost models into memory`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const costModels: any[] = await queryInterface.select(null, 'CostModels')

  // Update data in a transaction
  await queryInterface.sequelize.transaction(async transaction => {
    logger.info(`Remove non-JSONB 'variables' column`)
    await queryInterface.removeColumn('CostModels', 'variables', {
      transaction,
    })

    logger.info(`Add new JSONB 'variables' column`)
    await queryInterface.addColumn(
      'CostModels',
      'variables',
      {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      { transaction },
    )

    logger.info(`Migrating cost models to JSONB variables`)
    for (const costModel of costModels) {
      try {
        logger.info(`Migrating cost model`, {
          id: costModel.id,
          deployment: costModel.deployment,
        })

        let variables
        try {
          variables =
            costModel.variables === null
              ? null
              : JSON.parse(costModel.variables)
        } catch (error) {
          throw new Error(`Variables are invalid JSON: ${error}`)
        }

        // Skip model if variables are invalid
        if (
          variables === null ||
          !(variables instanceof Object) ||
          variables instanceof Array
        ) {
          throw new Error(`Variables must be a JSON object or null`)
        }

        // Update variables in the db
        const sqlVariables =
          variables === null ? 'null' : `'${JSON.stringify(variables)}'`
        await queryInterface.sequelize.query(
          `UPDATE "CostModels" SET variables = ${sqlVariables} WHERE id = '${costModel.id}'`,
          { transaction },
        )
      } catch (err) {
        logger.warn(`Failed to migrate cost model`, {
          id: costModel.id,
          deployment: costModel.deployment,
          err: indexerError(IndexerErrorCode.IE021, err),
        })
      }
    }
  })
}

export async function down({ context }: Context): Promise<void> {
  // We don't expect to do this; just in case, replace the JSONB column with TEXT again
  await context.queryInterface.sequelize.transaction(async transaction => {
    await context.queryInterface.removeColumn('CostModels', 'variables', {
      transaction,
    })
    await context.queryInterface.addColumn(
      'CostModels',
      'variables',
      {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      { transaction },
    )
  })
}
