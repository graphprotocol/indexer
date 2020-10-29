import { createClient } from '@urql/core'
import fetch from 'isomorphic-fetch'
import {IndexerManagementClient} from "@graphprotocol/indexer-common";

export const createIndexerManagementClient = async ({
  url,
}: {
  url: string
}): Promise<IndexerManagementClient> => {
  return (createClient({ url, fetch }) as unknown) as IndexerManagementClient
}
