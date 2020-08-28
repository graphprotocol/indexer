/**
 * Assumes a graph-node is running
 */

import * as supertest from 'supertest'
import * as express from 'express'
import { Wallet, constants } from 'ethers'

import { createLogger, createMetrics } from '@graphprotocol/common-ts'

import { createApp } from '..'
import { QueryProcessor } from '../../queries'
import { ReceiptManager } from '../../receipt-manager'

describe('Server', () => {
  let receiptManager: ReceiptManager
  let app: express.Express

  beforeAll(async () => {
    const logger = createLogger({ name: 'server.test.ts' })
    const metrics = createMetrics()

    receiptManager = new ReceiptManager(
      logger.child({ component: 'PaymentManager' }),
      Wallet.createRandom().privateKey,
    )

    app = await createApp({
      logger,
      port: 9600,
      receiptManager,
      queryProcessor: new QueryProcessor({
        logger: logger.child({ component: 'QueryProcessor' }),
        graphNode: 'http://localhost:9000/',
        metrics,
        receiptManager,
        chainId: 1,
        disputeManagerAddress: constants.AddressZero,
      }),
      graphNodeStatusEndpoint: 'http://localhost:9030/graphql',
      metrics,
      freeQueryAuthToken: '',
    })
  })

  it('is ready to roll', async () => {
    await supertest(app).get('/').expect(200)
  })
})
