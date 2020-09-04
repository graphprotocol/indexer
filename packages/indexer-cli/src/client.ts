import { createClient, Client } from '@urql/core'
import fetch from 'isomorphic-fetch'

export const createIndexerManagementClient = async ({
  url,
}: {
  url: string
}): Promise<Client> => {
  return createClient({ url, fetch })
}
