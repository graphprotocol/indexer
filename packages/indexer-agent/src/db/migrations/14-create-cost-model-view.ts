import { Logger } from '@graphprotocol/common-ts'
import { utils } from 'ethers'
import { QueryInterface, DataTypes } from 'sequelize'

interface MigrationContext {
  queryInterface: QueryInterface
  logger: Logger
}

interface Context {
  context: MigrationContext
}
export const COST_MODEL_GLOBAL = 'global'
export async function up({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  const tables = await queryInterface.showAllTables()
  logger.debug(`Checking if cost_models table exists`, { tables })

  if (tables.includes('cost_models')) {
    logger.debug(`cost_models already exist, migration not necessary`)
  } else {
    logger.info(`Create cost_models`)
    await queryInterface.createTable('cost_models', {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        unique: true,
      },
      deployment: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isDeploymentID: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Deployment ID must be a string')
            }
            // "0x..." and "global" is ok
            if (utils.isHexString(value, 32) || value === COST_MODEL_GLOBAL) {
              return
            }

            throw new Error(
              `Deployment ID must be a valid subgraph deployment ID or "global"`,
            )
          },
        },
      },
      model: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      variables: {
        type: DataTypes.JSONB,
        allowNull: true,
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
  }
  if (tables.includes('CostModels')) {
    logger.debug(`Copying data from CostModels into cost_models`)
    const copyTableSQL = `
        INSERT INTO cost_models (id, deployment, model, variables, created_at, updated_at) 
        SELECT id, deployment, model, variables, "createdAt", "updatedAt" FROM "CostModels";
    `
    await queryInterface.sequelize.query(copyTableSQL)
    logger.info(`Drop table "CostModels"`)
    await queryInterface.dropTable('CostModels', { cascade: true })
  }

  logger.info(
    `Creating a view for cost_models to substitute "CostModels" table`,
  )
  const viewSQL = `
    CREATE VIEW "CostModels" AS WITH temp_view as (
      SELECT id, deployment, model, variables, created_at, updated_at
      , ROW_NUMBER() OVER (PARTITION BY deployment ORDER BY created_at DESC) as row_num from cost_models
    )
    SELECT id, deployment, model, variables, created_at as "createdAt", updated_at as "updatedAt"
    FROM temp_view
    WHERE row_num = 1;
  `

  await queryInterface.sequelize.query(viewSQL)
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.info(`Drop view "CostModels"`)
  await queryInterface.sequelize.query('DROP VIEW IF EXISTS "CostModels"')
  logger.info(`Drop table cost_models`)
  await queryInterface.dropTable('cost_models')
}
