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

  logger.info(
    'Deleting old function/trigger for cost models to add the model field',
  )

  const dropFunctionSQL = `
        DROP FUNCTION IF EXISTS cost_models_update_notify() CASCADE;
    `
  await queryInterface.sequelize.query(dropFunctionSQL)

  const functionSQL = `
        CREATE FUNCTION cost_models_update_notify()
        RETURNS trigger AS
        $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            PERFORM pg_notify('cost_models_update_notification', format('{"tg_op": "DELETE", "deployment": "%s"}', OLD.deployment));
            RETURN OLD;
          ELSIF TG_OP = 'INSERT' THEN
            PERFORM pg_notify('cost_models_update_notification', format('{"tg_op": "INSERT", "deployment": "%s", "model": "%s"}', NEW.deployment, NEW.model));
            RETURN NEW;
          ELSE
            PERFORM pg_notify('cost_models_update_notification', format('{"tg_op": "%s", "deployment": "%s", "model": "%s"}', NEW.deployment, NEW.model));
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
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context
  logger.info(`Drop function, trigger, indices, and table`)
  queryInterface.removeColumn('scalar_tap_receipts_invalid', 'error_log')
}
