import type { CodegenConfig } from '@graphql-codegen/cli'
import { defineConfig } from '@eddeee888/gcg-typescript-resolver-files'

const config: CodegenConfig = {
  schema: 'src/indexer-management/schema.graphql',
  hooks: {
    afterOneFileWrite: ['yarn format'],
  },
  generates: {
    'src/schema': defineConfig({
      typesPluginsConfig: {
        contextType: '@graphprotocol/indexer-common#IndexerManagementResolverContext',
        enumsAsConst: true,
        enumsAsTypes: false,
      },
    }),
  },
}
export default config
