/**
 * Assumes a graph-node is running
 */

import * as supertest from 'supertest'
import * as express from 'express'
import { Wallet, constants } from 'ethers'

import { createLogger, createMetrics } from '@graphprotocol/common-ts'

import { PaymentManager } from '../../payment-manager'
import { createApp } from '..'
import { QueryProcessor } from '../../queries'

describe('Server', () => {
  let paymentManager: PaymentManager
  let app: express.Express

  beforeAll(async () => {
    const logger = createLogger({ name: 'server.test.ts' })
    const metrics = createMetrics()

    paymentManager = new PaymentManager({
      wallet: Wallet.createRandom(),
      logger: logger.child({ component: 'PaymentManager' }),
      metrics,
    })

    app = await createApp({
      logger,
      port: 9600,
      paymentManager,
      queryProcessor: new QueryProcessor({
        logger: logger.child({ component: 'QueryProcessor' }),
        graphNode: 'http://localhost:9000/',
        metrics,
        paymentManager,
        chainId: 1,
        disputeManagerAddress: constants.AddressZero,
      }),
      graphNodeStatusEndpoint: 'http://localhost:9030/graphql',
      metrics,
      freeQueryAuthToken: '',
    })
  })

  it('is ready to roll', async () => {
    await supertest(app)
      .get('/')
      .expect(200)
  })
})
