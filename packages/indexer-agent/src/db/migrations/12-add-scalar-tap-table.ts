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
  logger.debug(`Checking if scalar_tap_receipts table exists`, { tables })

  if (tables.includes('scalar_tap_receipts')) {
    logger.debug(`scalar_tap_receipts already exist, migration not necessary`)
  } else {
    logger.info(`Create scalar_tap_receipts`)
    await queryInterface.createTable('scalar_tap_receipts', {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      allocation_id: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      signer_address: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      signature: {
        type: DataTypes.BLOB,
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
    CREATE FUNCTION scalar_tap_receipt_notify()
    RETURNS trigger AS
    $$
    BEGIN
        PERFORM pg_notify('scalar_tap_receipt_notification', format('{"id": %s, "allocation_id": "%s", "signer_address": "%s", "timestamp_ns": %s, "value": %s}', NEW.id, NEW.allocation_id, NEW.signer_address, NEW.timestamp_ns, NEW.value));
        RETURN NEW;
    END;
    $$ LANGUAGE 'plpgsql';
  `
  const triggerSQL = `
    CREATE TRIGGER receipt_update AFTER INSERT OR UPDATE
    ON scalar_tap_receipts
    FOR EACH ROW EXECUTE PROCEDURE scalar_tap_receipt_notify();
  `
  queryInterface.addIndex('scalar_tap_receipts', ['allocation_id'], {
    name: 'scalar_tap_receipts_allocation_id_idx'
  })
  queryInterface.addIndex('scalar_tap_receipts', ['timestamp_ns'], {
    name: 'scalar_tap_receipts_timestamp_ns_idx'
  })

  if (tables.includes('scalar_tap_receipts_invalid')) {
    logger.info(
      `scalar_tap_receipts_invalid already exist, migration not necessary`
    )
    return
  }
  // Create the scalar_tap_ravs table if it doesn't exist
  await queryInterface.createTable('scalar_tap_receipts_invalid', {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
    },
    allocation_id: {
      type: DataTypes.CHAR(40),
      allowNull: false,
    },
    sender_address: {
      type: DataTypes.CHAR(40),
      allowNull: false,
    },
    signer_address: {
      type: DataTypes.CHAR(40),
      allowNull: false,
    },
    timestamp_ns: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    value: {
      type: DataTypes.DECIMAL(20),
      allowNull: false,
    },
    final: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    last: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    received_receipt: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  })
  await queryInterface.sequelize.query(functionSQL)
  await queryInterface.sequelize.query(triggerSQL)

  if (tables.includes('scalar_tap_ravs')) {
    logger.info(`scalar_tap_ravs already exist, migration not necessary`)
    return
  }
  // Create the scalar_tap_ravs table if it doesn't exist
  await queryInterface.createTable('scalar_tap_ravs', {
    allocation_id: {
      type: DataTypes.CHAR(40),
      allowNull: false,
    },
    sender_address: {
      type: DataTypes.CHAR(40),
      allowNull: false,
    },
    signature: {
      type: DataTypes.BLOB,
      allowNull: false,
    },
    timestamp_ns: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    value_aggregate: {
      type: DataTypes.DECIMAL(20),
      allowNull: false,
    },
    final: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    last: {
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

  logger.info(`Add primary key`)
  await queryInterface.addConstraint('scalar_tap_ravs', {
    fields: ['allocation_id', 'sender_address'],
    type: 'primary key',
    name: 'pk_scalar_tap_ravs',
  })
  if (tables.includes('allocation_summaries')) {
    logger.info(
      `Remove one-to-one relationship between AllocationSummary and Voucher`,
    )
    await queryInterface.removeConstraint('allocation_summaries', 'voucher')

    logger.info(`Add RAV association with AllocationSummary`)
    await queryInterface.addConstraint('scalar_tap_ravs', {
      fields: ['allocation_id'],
      type: 'foreign key',
      name: 'allocation_summary',
      references: {
        table: 'allocation_summaries',
        field: 'allocation',
      },
      onDelete: 'cascade',
      onUpdate: 'cascade',
    })
  } else {
    logger.error(`Table allocation_summaries does not exist`)
  }

  await queryInterface.createTable('scalar_tap_rav_requests_failed', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    allocation_id: {
      type: DataTypes.CHAR(40),
      allowNull: false,
    },
    sender_address: {
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

  logger.info(`Remove foreign relationship`)
  await queryInterface.removeConstraint('scalar_tap_ravs', 'allocationSummary')

  // Drop the scalar_tap_ravs table
  logger.info(`Drop table`)
  await queryInterface.dropTable('scalar_tap_ravs')

  logger.info(
    `Re-add the one-to-one relationship between AllocationSummary and Voucher`,
  )
  await queryInterface.addConstraint('vouchers', {
    fields: ['allocation'],
    type: 'foreign key',
    name: 'allocationSummary',
    references: {
      table: 'allocation_summaries',
      field: 'allocation',
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  })

  logger.info(`Drop function, trigger, indices, and table`)
  await queryInterface.sequelize.query(
    'DROP TRIGGER IF EXISTS receipt_update ON scalar_tap_receipts',
  )
  await queryInterface.sequelize.query(
    'DROP FUNCTION IF EXISTS scalar_tap_receipt_notify',
  )
  await queryInterface.removeIndex(
    'scalar_tap_receipts',
    'scalar_tap_receipts_allocation_id_idx',
  )
  await queryInterface.removeIndex(
    'scalar_tap_receipts',
    'scalar_tap_receipts_timestamp_ns_idx',
  )
  await queryInterface.dropTable('scalar_tap_receipts')
}
