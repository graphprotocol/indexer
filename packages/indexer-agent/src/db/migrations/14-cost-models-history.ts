import { Logger } from '@graphprotocol/common-ts'
import { isHexString } from 'ethers'
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
  logger.debug(`Checking if CostModelsHistory table exists`, { tables })

  // CostModelsHistory: this table will store the history of cost models
  // this is necessary since there could be a mismtach between the old table and the info the gateway has
  // causing a failed request. Solution is to have a history and allow the "old" model for a limited time frame 2-3 mins
  // For indexer-service is also helpful to have the history of the cost models since we want to obtain the minimum cost per receipt
  // this will help since the gateway could send an old model and get blocked so we need the indexer to accept one of the 2 latest models
  // in the past 30 seconds since the gateway updates its model every 30 seconds

  if (tables.includes('CostModelsHistory')) {
    logger.debug(`CostModelsHistory already exist, migration not necessary`)
  } else {
    logger.info(`Create CostModelsHistory`)
    await queryInterface.createTable('CostModelsHistory', {
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
            if (isHexString(value, 32) || value === COST_MODEL_GLOBAL) {
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
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    })
    if (tables.includes('CostModels')) {
      logger.debug(`Copying data from CostModels into CostModelsHistory`)
      const copyTableSQL = `
          INSERT INTO "CostModelsHistory"
          SELECT * FROM "CostModels";
      `
      await queryInterface.sequelize.query(copyTableSQL)
      logger.info(`Drop table "CostModels"`)
      await queryInterface.dropTable('CostModels', { cascade: true })
    }
    // To avoid creating a breaking change for the indexer-agent or indexer-service we create a view table
    // Since now other systems can keep the same query towards "CostModels" and not need to change anything

    logger.info(
      `Creating a view for CostModelsHistory to substitute "CostModels" table`,
    )
    const viewSQL = `
      CREATE VIEW "CostModels" AS SELECT id,
       deployment,
       model,
       variables,
       "createdAt",
       "updatedAt"
      FROM "CostModelsHistory" t1
      JOIN
      (
          SELECT MAX(id)
          FROM "CostModelsHistory"
          GROUP BY deployment
      ) t2
        ON t1.id = t2.MAX;
    `
    // We also need to create a trigger to notify indexer-service when a new cost model is added
    // instead of it polling the db
    await queryInterface.sequelize.query(viewSQL)

    const functionSQL = `
        CREATE FUNCTION cost_models_update_notify()
        RETURNS trigger AS
        $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            PERFORM pg_notify('cost_models_update_notification', format('{"tg_op": "DELETE", "deployment": "%s"}', OLD.deployment));
            RETURN OLD;
          ELSIF TG_OP = 'INSERT' THEN
            PERFORM pg_notify('cost_models_update_notification', format('{"tg_op": "INSERT", "deployment": "%s"}', NEW.deployment));
            RETURN NEW;
          ELSE -- UPDATE OR TRUNCATE, should never happen
            PERFORM pg_notify('cost_models_update_notification', format('{"tg_op": "%s", "deployment": null}', TG_OP, NEW.deployment));
            RETURN NEW;
          END IF;
        END;
        $$ LANGUAGE 'plpgsql';
    `
    const triggerSQL = `
        CREATE TRIGGER cost_models_update AFTER INSERT OR UPDATE OR DELETE
        ON "CostModelsHistory"
        FOR EACH ROW EXECUTE PROCEDURE cost_models_update_notify();
    `
    await queryInterface.sequelize.query(functionSQL)
    await queryInterface.sequelize.query(triggerSQL)
    // Need to update sequence value for table else it will be unsynced with actual data
    logger.info(`Update sequence for CostModelsHistory`)
    const updateIdSeqSQL = `SELECT setval('"CostModelsHistory_id_seq"', (SELECT MAX(id) FROM "CostModelsHistory"));`
    await queryInterface.sequelize.query(updateIdSeqSQL)
  }
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.info(`Drop view "CostModels"`)
  await queryInterface.sequelize.query('DROP VIEW IF EXISTS "CostModels"')
  logger.info(`Drop table CostModelsHistory`)
  await queryInterface.dropTable('CostModelsHistory')
}
