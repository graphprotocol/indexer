import { cliTest, setup, teardown } from '../util'
import path from 'path'

const baseDir = path.join(__dirname, '..')

describe('Indexer rules tests', () => {
  describe('With indexer management server', () => {
    beforeEach(setup)
    afterEach(teardown)

    cliTest(
      'Indexer connect - success',
      ['indexer', 'connect', 'http://localhost:18000'],
      'references/indexer-connect',
      {
        expectedExitCode: 0,
        cwd: baseDir,
        timeout: 10000,
      },
    )

    describe('Rules help', () => {
      cliTest('Indexer rules', ['indexer', 'rules'], 'references/indexer-rules', {
        expectedExitCode: 255,
        cwd: baseDir,
        timeout: 10000,
      })
      cliTest(
        'Indexer rules help',
        ['indexer', 'rules', '--help'],
        'references/indexer-rules',
        {
          expectedExitCode: 255,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Rules start...', () => {
      cliTest(
        'Indexer rules start - success',
        ['indexer', 'rules', 'start', 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr'],
        'references/indexer-rule-always',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules start - no args',
        ['indexer', 'rules', 'start'],
        'references/indexer-rules-command-no-args',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules start - invalid deployment ID ',
        ['indexer', 'rules', 'start', 'Qmemememememe'],
        'references/invalid-deployment-id-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Rules stop...', () => {
      cliTest(
        'Indexer rules stop - success',
        ['indexer', 'rules', 'stop', 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr'],
        'references/indexer-rule-never',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules stop - no args',
        ['indexer', 'rules', 'stop'],
        'references/indexer-rules-command-no-args',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules stop - invalid deployment ID',
        ['indexer', 'rules', 'stop', 'Qmemememememe'],
        'references/invalid-deployment-id-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Rules maybe...', () => {
      cliTest(
        'Indexer rules maybe - success',
        ['indexer', 'rules', 'maybe', 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr'],
        'references/indexer-rule-rules',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules maybe - no args',
        ['indexer', 'rules', 'maybe'],
        'references/indexer-rules-command-no-args',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules maybe - invalid deployment ID ',
        ['indexer', 'rules', 'maybe', 'Qmemememememe'],
        'references/invalid-deployment-id-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Rules clear...', () => {
      cliTest(
        'Indexer rules clear - success',
        ['indexer', 'rules', 'clear', 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr'],
        'references/indexer-rule-rules',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules clear - no args',
        ['indexer', 'rules', 'clear'],
        'references/indexer-rules-command-no-args',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules clear - invalid deployment ID ',
        ['indexer', 'rules', 'clear', 'Qmemememememe'],
        'references/invalid-deployment-id-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })

    describe('Rules delete...', () => {
      cliTest(
        'Indexer rules delete - success',
        ['indexer', 'rules', 'delete', 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr'],
        'references/indexer-rule-deleted-success',
        {
          expectedExitCode: 0,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules delete - no args',
        ['indexer', 'rules', 'delete'],
        'references/indexer-rules-command-no-args-including-all',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
      cliTest(
        'Indexer rules delete - invalid deployment ID ',
        ['indexer', 'rules', 'delete', 'Qmemememememe'],
        'references/invalid-deployment-id-arg',
        {
          expectedExitCode: 1,
          cwd: baseDir,
          timeout: 10000,
        },
      )
    })
  })

  describe('Without indexer management server', () => {
    cliTest(
      'Indexer rules start - not connected',
      ['indexer', 'rules', 'start', 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr'],
      'references/indexer-not-connected',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer rules stop - not connected',
      ['indexer', 'rules', 'stop', 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr'],
      'references/indexer-not-connected',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer rules maybe - not connected',
      ['indexer', 'rules', 'maybe', 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr'],
      'references/indexer-not-connected',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer rules get - no args',
      ['indexer', 'rules', 'get'],
      'references/indexer-rules-command-no-args-including-all',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer rules get - not connected',
      ['indexer', 'rules', 'get', 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr'],
      'references/indexer-not-connected',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer rules delete - not connected',
      ['indexer', 'rules', 'delete', 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr'],
      'references/indexer-not-connected',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
    cliTest(
      'Indexer rules clear - not connected',
      ['indexer', 'rules', 'clear', 'QmZZtzZkfzCWMNrajxBf22q7BC9HzoT5iJUK3S8qA6zNZr'],
      'references/indexer-not-connected',
      {
        expectedExitCode: 1,
        cwd: baseDir,
        timeout: 10000,
      },
    )
  })
})
