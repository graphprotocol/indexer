
# Contributing to Indexer Components

Welcome to the Graph Protocol! Thanks a ton for your interest in contributing.

If you run into any problems feel free to create an issue. PRs are much appreciated for simple things. Here's [a list of good first issues](https://github.com/graphprotocol/indexer/labels/good%20first%20issue). If it's something more complex we'd appreciate having a quick chat in GitHub Issues or Discord.

Join the conversation on our [Discord](https://discord.gg/graphprotocol).

Please follow the [Code of Conduct](https://github.com/graphprotocol/graph-node/blob/master/CODE_OF_CONDUCT.md) for all the communications and at events. Thank you!

## Development flow

#### Clone the repository and install the dependencies:

```sh
git clone git@github.com:graphprotocol/indexer.git
cd indexer
yarn
```

#### To run the tests:

```sh
yarn test
```

#### Creating new resolvers

The [`indexer-common`](./packages/indexer-common/) package is shared between the different indexer packages in this repository. If you are creating a new resolver, you should add it to the `indexer-common` package. This way, the resolver can be shared between the different indexer packages. To introduce a new resolver, you should:
1. Add the GraphQL schema in [`packages/indexer-common/src/indexer-management/schema.graphql`](./packages/indexer-common/src/indexer-management/schema.graphql).
2. Run `yarn codegen` this uses the [GraphQL Codegen Server preset](https://the-guild.dev/graphql/codegen/docs/guides/graphql-server-apollo-yoga-with-server-preset) to generate TypeScript types for the schema and resolvers.
3. Now you should see resolver in [`packages/indexer-common/src/schema/indexer-management/resolvers`](./packages/indexer-common/src/schema/indexer-management/resolvers/) directory and write the logic for the resolver in the file.

#### GraphQL Unit Testing

We use [Jest](https://jestjs.io/) for unit testing. You can write tests for your resolvers in the `__tests__` directory in the same directory as the resolver. For example, if you have a resolver in `packages/indexer-common/src/schema/indexer-management/resolvers/MyResolver.ts`, you should write tests for it in `packages/indexer-common/src/schema/indexer-management/resolvers/__tests__/MyResolver.test.ts`. The test setup utilizes [HTTP Injection from GraphQL Yoga](https://the-guild.dev/graphql/yoga-server/docs/features/testing).

## Commit messages and pull requests

We use the  following format for commit messages:
`{package-name}: {Brief description of changes}`, for example: `indexer-cli: Remove l1 support`.

If multiple packages are being changed list them all like this: `all: `

If a shared package is touched and impacts multiple packages, you can use short-had like this: `*: `.

The body of the message can be terse, with just enough information to explain what the commit does overall. In a lot of cases, more extensive explanations of _how_ the commit achieves its goal are better as comments
in the code.

Commits in a pull request should be structured in such a way that each commit consists of a small logical step towards the overall goal of the pull request. Your pull request should make it as easy as possible for the
reviewer to follow each change you are making. For example, it is a good idea to separate simple mechanical changes like renaming a method that touches many files from logic changes. Your pull request should not be
structured into commits according to how you implemented your feature, often indicated by commit messages like 'Fix problem' or 'Cleanup'. Flex a bit, and make the world think that you implemented your feature perfectly, in small logical steps, in one sitting without ever having to touch up something you did earlier in the pull request. (In reality, that means you'll use `git rebase -i` a lot)
