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
  logger.debug(`Checking if tap_horizon_receipts table exists`, { tables })

  if (tables.includes('tap_horizon_receipts')) {
    logger.debug(`tap_horizon_receipts already exist, migration not necessary`)
  } else {
    logger.info(`Create tap_horizon_receipts`)
    await queryInterface.createTable('tap_horizon_receipts', {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      signer_address: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },

      // Values below are the individual fields of the EIP-712 receipt
      signature: {
        type: DataTypes.BLOB,
        allowNull: false,
      },
      collection_id: {
        type: DataTypes.CHAR(64),
        allowNull: false,
      },
      payer: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      data_service: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      service_provider: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      timestamp_ns: {
        type: DataTypes.DECIMAL(20),
        allowNull: false,
      },
      nonce: {
        type: DataTypes.DECIMAL,
        allowNull: false,
      },
      value: {
        type: DataTypes.DECIMAL(39),
        allowNull: false,
      },
    })
  }

  logger.debug('Create function and trigger using raw SQL')
  const functionSQL = `
    CREATE FUNCTION tap_horizon_receipt_notify()
    RETURNS trigger AS
    $$
    BEGIN
        PERFORM pg_notify('tap_horizon_receipt_notification', format('{"id": %s, "collection_id": "%s", "signer_address": "%s", "timestamp_ns": %s, "value": %s}', NEW.id, NEW.collection_id, NEW.signer_address, NEW.timestamp_ns, NEW.value));
        RETURN NEW;
    END;
    $$ LANGUAGE 'plpgsql';
  `
  const triggerSQL = `
    CREATE TRIGGER receipt_update AFTER INSERT OR UPDATE
    ON tap_horizon_receipts
    FOR EACH ROW EXECUTE PROCEDURE tap_horizon_receipt_notify();
  `
  await queryInterface.sequelize.query(functionSQL)
  await queryInterface.sequelize.query(triggerSQL)

  queryInterface.addIndex('tap_horizon_receipts', ['collection_id'], {
    name: 'tap_horizon_receipts_collection_id_idx',
  })
  queryInterface.addIndex('tap_horizon_receipts', ['timestamp_ns'], {
    name: 'tap_horizon_receipts_timestamp_ns_idx',
  })

  if (tables.includes('tap_horizon_receipts_invalid')) {
    logger.info(
      `tap_horizon_receipts_invalid already exist, migration not necessary`,
    )
  } else {
    // Create the tap_horizon_ravs table if it doesn't exist
    await queryInterface.createTable('tap_horizon_receipts_invalid', {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      signer_address: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },

      // Values below are the individual fields of the EIP-712 receipt
      signature: {
        type: DataTypes.BLOB,
        allowNull: false,
      },
      collection_id: {
        type: DataTypes.CHAR(64),
        allowNull: false,
      },
      payer: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      data_service: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      service_provider: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      timestamp_ns: {
        type: DataTypes.DECIMAL(20),
        allowNull: false,
      },
      nonce: {
        type: DataTypes.DECIMAL,
        allowNull: false,
      },
      value: {
        type: DataTypes.DECIMAL(20),
        allowNull: false,
      },
      error_log: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    })
  }

  if (tables.includes('tap_horizon_ravs')) {
    logger.info(`tap_horizon_ravs already exist, migration not necessary`)
  } else {
    // Create the tap_horizon_ravs table if it doesn't exist
    await queryInterface.createTable('tap_horizon_ravs', {
      // Values below are the individual fields of the EIP-712 receipt
      signature: {
        type: DataTypes.BLOB,
        allowNull: false,
      },
      collection_id: {
        type: DataTypes.CHAR(64),
        allowNull: false,
      },
      payer: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      data_service: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      service_provider: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      timestamp_ns: {
        type: DataTypes.DECIMAL(20),
        allowNull: false,
      },
      value_aggregate: {
        type: DataTypes.DECIMAL(39),
        allowNull: false,
      },
      metadata: {
        type: DataTypes.BLOB,
        allowNull: false,
      },

      last: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      final: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      redeemed_at: {
        type: DataTypes.DATE,
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

  logger.info(`Add primary key`)
  await queryInterface.addConstraint('tap_horizon_ravs', {
    fields: ['payer', 'data_service', 'service_provider', 'collection_id'],
    type: 'primary key',
    name: 'pk_tap_horizon_ravs',
  })

  await queryInterface.createTable('tap_horizon_rav_requests_failed', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    collection_id: {
      type: DataTypes.CHAR(64),
      allowNull: false,
    },
    payer: {
      type: DataTypes.CHAR(40),
      allowNull: false,
    },
    data_service: {
      type: DataTypes.CHAR(40),
      allowNull: false,
    },
    service_provider: {
      type: DataTypes.CHAR(40),
      allowNull: false,
    },
    expected_rav: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    rav_response: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    reason: {
      allowNull: false,
      type: DataTypes.TEXT,
    },
  })
}

export async function down({ context }: Context): Promise<void> {
  const { queryInterface, logger } = context
  // Drop the tap_horizon_ravs table
  logger.info(`Drop table`)
  await queryInterface.dropTable('tap_horizon_ravs')

  logger.info(`Drop function, trigger, indices, and table`)
  await queryInterface.sequelize.query(
    'DROP TRIGGER IF EXISTS receipt_update ON tap_horizon_receipts',
  )
  await queryInterface.sequelize.query(
    'DROP FUNCTION IF EXISTS tap_horizon_receipt_notify',
  )
  await queryInterface.removeIndex(
    'tap_horizon_receipts',
    'tap_horizon_receipts_collection_id_idx',
  )
  await queryInterface.removeIndex(
    'tap_horizon_receipts',
    'tap_horizon_receipts_timestamp_ns_idx',
  )
  await queryInterface.dropTable('tap_horizon_receipts')
}
