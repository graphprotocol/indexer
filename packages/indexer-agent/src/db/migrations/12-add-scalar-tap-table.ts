import { Logger } from '@graphprotocol/common-ts'
import { QueryInterface, DataTypes, QueryTypes } from 'sequelize'

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
      sender_address: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      timestamp_ns: {
        type: DataTypes.DECIMAL(20),
        allowNull: false,
      },
      value: {
        type: DataTypes.DECIMAL(39),
        allowNull: false,
      },
      receipt: {
        type: DataTypes.JSON,
        allowNull: false,
      },
    })
  }

  logger.debug('Create function and trigger using raw SQL')
  // const schemas = await queryInterface.showAllSchemas()
  const functionSQL = `DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc 
      INNER JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid
      WHERE proname = 'scalar_tap_receipt_notify' 
      AND nspname = 'public'  -- or your specific schema if not public
  ) THEN
      EXECUTE $func$
        CREATE FUNCTION scalar_tap_receipt_notify()
        RETURNS trigger AS $body$
        BEGIN
            PERFORM pg_notify('scalar_tap_receipt_notification', format('{"id": %s, "allocation_id": "%s", "sender_address": "%s", "timestamp_ns": %s, "value": %s}', NEW.id, NEW.allocation_id, NEW.sender_address, NEW.timestamp_ns, NEW.value));
            RETURN NEW;
        END;
        $body$ LANGUAGE plpgsql;
      $func$;
    END IF;
  END $$;`
  await queryInterface.sequelize.query(functionSQL)

  const triggerExists = async (triggerName: string, tableName: string) => {
    const query = `
      SELECT EXISTS (
        SELECT 1 
        FROM pg_trigger 
        WHERE tgname = '${triggerName}' 
        AND tgenabled = 'O' 
        AND tgrelid = (
          SELECT oid 
          FROM pg_class 
          WHERE relname = '${tableName}'
        )
      )`
    const result = await queryInterface.sequelize.query(query, {
      type: QueryTypes.SELECT,
    })
    return result.length > 0
  }

  if (!(await triggerExists('receipt_update', 'scalar_tap_receipts'))) {
    logger.info('Create trigger for receipt update')
    const triggerSQL = `
      CREATE TRIGGER receipt_update AFTER INSERT OR UPDATE
      ON scalar_tap_receipts
      FOR EACH ROW EXECUTE PROCEDURE scalar_tap_receipt_notify();
    `
    await queryInterface.sequelize.query(triggerSQL)
  }

  const indexExists = async (indexName: string, tableName: string) => {
    const query = `
      SELECT EXISTS (
        SELECT 1
        FROM pg_class t
        INNER JOIN pg_index d ON t.oid = d.indrelid
        INNER JOIN pg_class i ON d.indexrelid = i.oid
        WHERE i.relkind = 'i'
          AND i.relname = '${indexName}'
          AND t.relname = '${tableName}'
      )`
    const result = await queryInterface.sequelize.query(query, {
      type: QueryTypes.SELECT,
    })
    return result.length > 0
  }

  if (
    !(await indexExists(
      'scalar_tap_receipts_allocation_id_idx',
      'scalar_tap_receipts',
    ))
  ) {
    logger.debug('Create indices for allocation_id')
    await queryInterface.addIndex('scalar_tap_receipts', ['allocation_id'], {
      name: 'scalar_tap_receipts_allocation_id_idx',
    })
  }
  if (
    !(await indexExists(
      'scalar_tap_receipts_timestamp_ns_idx',
      'scalar_tap_receipts',
    ))
  ) {
    logger.info('Create indices for timestamp_ns')
    await queryInterface.addIndex('scalar_tap_receipts', ['timestamp_ns'], {
      name: 'scalar_tap_receipts_timestamp_ns_idx',
    })
  }

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
    rav: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    final: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    createdAt: {
      allowNull: false,
      type: DataTypes.DATE,
    },
    updatedAt: {
      allowNull: false,
      type: DataTypes.DATE,
    },
  })

  logger.info(`Add primary key`)
  await queryInterface.addConstraint('scalar_tap_ravs', {
    fields: ['allocation_id', 'sender_address'],
    type: 'primary key',
    name: 'pk_scalar_tap_ravs',
  })

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
