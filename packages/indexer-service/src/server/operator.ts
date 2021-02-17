import { Router } from 'express'

export interface OperatorServerOptions {
  operatorPublicKey: string
}

export const createOperatorServer = async (
  options: OperatorServerOptions,
): Promise<Router> => {
  const router = Router()

  router.get('/info', (req, res) => {
    res.send({ publicKey: options.operatorPublicKey })
  })

  return router
}
