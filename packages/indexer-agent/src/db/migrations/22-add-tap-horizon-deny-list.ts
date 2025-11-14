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
  logger.debug(`Checking if tap_horizon_denylist table exists`, { tables })

  if (tables.includes('tap_horizon_denylist')) {
    logger.debug(`tap_horizon_denylist already exist, migration not necessary`)
  } else {
    logger.info(`Create tap_horizon_denylist`)
    await queryInterface.createTable('tap_horizon_denylist', {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      sender_address: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
    })
  }
  const functionSQL = `
        CREATE FUNCTION tap_horizon_deny_notify()
        RETURNS trigger AS
        $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            PERFORM pg_notify('tap_horizon_deny_notification', format('{"tg_op": "DELETE", "sender_address": "%s"}', OLD.sender_address));
            RETURN OLD;
          ELSIF TG_OP = 'INSERT' THEN
            PERFORM pg_notify('tap_horizon_deny_notification', format('{"tg_op": "INSERT", "sender_address": "%s"}', NEW.sender_address));
            RETURN NEW;
          ELSE -- UPDATE OR TRUNCATE, should never happen
            PERFORM pg_notify('tap_horizon_deny_notification', format('{"tg_op": "%s", "sender_address": null}', TG_OP, NEW.sender_address));
            RETURN NEW;
          END IF;
        END;
        $$ LANGUAGE 'plpgsql';
    `
  const triggerSQL = `
        CREATE TRIGGER deny_update AFTER INSERT OR UPDATE OR DELETE
        ON tap_horizon_denylist
        FOR EACH ROW EXECUTE PROCEDURE tap_horizon_deny_notify();
    `

  await queryInterface.sequelize.query(functionSQL)
  await queryInterface.sequelize.query(triggerSQL)
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context

  logger.info(`Drop tap_horizon_denylist`)
  await queryInterface.sequelize.query(
    'DROP TRIGGER IF EXISTS deny_update ON tap_horizon_denylist',
  )
  logger.info(`Drop function tap_horizon_deny_notify`)
  await queryInterface.sequelize.query(
    'DROP FUNCTION IF EXISTS tap_horizon_deny_notify',
  )
  logger.info(`Drop table tap_horizon_denylist`)
  await queryInterface.dropTable('tap_horizon_denylist')
}
