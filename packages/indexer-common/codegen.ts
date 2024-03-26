import type { CodegenConfig } from '@graphql-codegen/cli'
import { defineConfig } from '@eddeee888/gcg-typescript-resolver-files'

const config: CodegenConfig = {
  schema: 'src/indexer-management/schema.graphql',
  generates: {
    'src/schema': defineConfig({
      typesPluginsConfig: {
        contextType: '@graphprotocol/indexer-common#IndexerManagementResolverContext',
        enumsAsTypes: true,
      },
    }),
  },
}
export default config
