import path from 'path'
import { Umzug, SequelizeStorage } from 'umzug'
import { Sequelize } from 'sequelize'
import { createLogger } from '@tokene-q/common-ts'

const verbose_logging = process.env.VERBOSE === 'true'
const log_level = verbose_logging ? 'trace' : 'info'
const host = process.env.POSTGRES_HOST || 'localhost'
const port = parseInt(process.env.POSTGRES_PORT || '5432')
const database = process.env.POSTGRES_DATABASE
const username = process.env.POSTGRES_USERNAME
const password = process.env.POSTGRES_PASSWORD

const logger = createLogger({
  name: 'Migrations',
  async: false,
  level: log_level,
})

if (!database) {
  throw Error(
    `Database name not defined, please set 'POSTGRES_DATABASE' ENV var`,
  )
}
if (!username) {
  throw Error(
    `Database 'username' name not defined, please set 'POSTGRES_USERNAME' ENV var`,
  )
}

logger.debug('Connect to database', {
  host,
  port,
  database,
  username,
  verbose_logging,
})

const sequelize = new Sequelize({
  dialect: 'postgres',
  host,
  port,
  username,
  password,
  database,
  pool: {
    max: 10,
    min: 0,
  },
  logging: false,
})

logger.debug('Successfully connected to DB', { name: database })

export const migrator = new Umzug({
  migrations: {
    glob: path.join(
      __dirname,
      '..',
      '..',
      '..',
      'dist',
      'db',
      'migrations',
      '*.js',
    ),
  },
  context: {
    queryInterface: sequelize.getQueryInterface(),
    logger,
  },
  storage: new SequelizeStorage({
    sequelize,
  }),
  logger: console,
})

export type Migration = typeof migrator._types.migration
