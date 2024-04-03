import { createClient } from '@urql/core'
import fetch from 'isomorphic-fetch'

export const createIndexerManagementClient = async ({ url }: { url: string }) => {
  return createClient({ url, fetch })
}
