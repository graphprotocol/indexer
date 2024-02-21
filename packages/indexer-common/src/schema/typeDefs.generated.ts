import type { DocumentNode } from 'graphql'
export const typeDefs = {
  kind: 'Document',
  definitions: [
    {
      kind: 'ScalarTypeDefinition',
      name: { kind: 'Name', value: 'BigInt', loc: { start: 7, end: 13 } },
      directives: [],
      loc: { start: 0, end: 13 },
    },
    {
      kind: 'EnumTypeDefinition',
      name: { kind: 'Name', value: 'OrderDirection', loc: { start: 20, end: 34 } },
      directives: [],
      values: [
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'asc', loc: { start: 39, end: 42 } },
          directives: [],
          loc: { start: 39, end: 42 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'desc', loc: { start: 45, end: 49 } },
          directives: [],
          loc: { start: 45, end: 49 },
        },
      ],
      loc: { start: 15, end: 51 },
    },
    {
      kind: 'EnumTypeDefinition',
      name: { kind: 'Name', value: 'IndexingDecisionBasis', loc: { start: 58, end: 79 } },
      directives: [],
      values: [
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'rules', loc: { start: 84, end: 89 } },
          directives: [],
          loc: { start: 84, end: 89 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'never', loc: { start: 92, end: 97 } },
          directives: [],
          loc: { start: 92, end: 97 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'always', loc: { start: 100, end: 106 } },
          directives: [],
          loc: { start: 100, end: 106 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'offchain', loc: { start: 109, end: 117 } },
          directives: [],
          loc: { start: 109, end: 117 },
        },
      ],
      loc: { start: 53, end: 119 },
    },
    {
      kind: 'EnumTypeDefinition',
      name: { kind: 'Name', value: 'IdentifierType', loc: { start: 126, end: 140 } },
      directives: [],
      values: [
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'deployment', loc: { start: 145, end: 155 } },
          directives: [],
          loc: { start: 145, end: 155 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'subgraph', loc: { start: 158, end: 166 } },
          directives: [],
          loc: { start: 158, end: 166 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'group', loc: { start: 169, end: 174 } },
          directives: [],
          loc: { start: 169, end: 174 },
        },
      ],
      loc: { start: 121, end: 176 },
    },
    {
      kind: 'InputObjectTypeDefinition',
      name: { kind: 'Name', value: 'AllocationFilter', loc: { start: 184, end: 200 } },
      directives: [],
      fields: [
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'status', loc: { start: 205, end: 211 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 213, end: 219 } },
            loc: { start: 213, end: 219 },
          },
          directives: [],
          loc: { start: 205, end: 219 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'allocation', loc: { start: 222, end: 232 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 234, end: 240 } },
            loc: { start: 234, end: 240 },
          },
          directives: [],
          loc: { start: 222, end: 240 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'subgraphDeployment',
            loc: { start: 243, end: 261 },
          },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 263, end: 269 } },
            loc: { start: 263, end: 269 },
          },
          directives: [],
          loc: { start: 243, end: 269 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'protocolNetwork', loc: { start: 272, end: 287 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 289, end: 295 } },
            loc: { start: 289, end: 295 },
          },
          directives: [],
          loc: { start: 272, end: 295 },
        },
      ],
      loc: { start: 178, end: 297 },
    },
    {
      kind: 'EnumTypeDefinition',
      name: { kind: 'Name', value: 'AllocationStatus', loc: { start: 304, end: 320 } },
      directives: [],
      values: [
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'Null', loc: { start: 325, end: 329 } },
          directives: [],
          loc: { start: 325, end: 329 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'Active', loc: { start: 332, end: 338 } },
          directives: [],
          loc: { start: 332, end: 338 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'Closed', loc: { start: 341, end: 347 } },
          directives: [],
          loc: { start: 341, end: 347 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'Finalized', loc: { start: 350, end: 359 } },
          directives: [],
          loc: { start: 350, end: 359 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'Claimed', loc: { start: 362, end: 369 } },
          directives: [],
          loc: { start: 362, end: 369 },
        },
      ],
      loc: { start: 299, end: 371 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'Allocation', loc: { start: 378, end: 388 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'id', loc: { start: 393, end: 395 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 397, end: 403 } },
              loc: { start: 397, end: 403 },
            },
            loc: { start: 397, end: 404 },
          },
          directives: [],
          loc: { start: 393, end: 404 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'indexer', loc: { start: 407, end: 414 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 416, end: 422 } },
              loc: { start: 416, end: 422 },
            },
            loc: { start: 416, end: 423 },
          },
          directives: [],
          loc: { start: 407, end: 423 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'subgraphDeployment',
            loc: { start: 426, end: 444 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 446, end: 452 } },
              loc: { start: 446, end: 452 },
            },
            loc: { start: 446, end: 453 },
          },
          directives: [],
          loc: { start: 426, end: 453 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'allocatedTokens', loc: { start: 456, end: 471 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 473, end: 479 } },
              loc: { start: 473, end: 479 },
            },
            loc: { start: 473, end: 480 },
          },
          directives: [],
          loc: { start: 456, end: 480 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'createdAtEpoch', loc: { start: 483, end: 497 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 499, end: 502 } },
              loc: { start: 499, end: 502 },
            },
            loc: { start: 499, end: 503 },
          },
          directives: [],
          loc: { start: 483, end: 503 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'closedAtEpoch', loc: { start: 506, end: 519 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Int', loc: { start: 521, end: 524 } },
            loc: { start: 521, end: 524 },
          },
          directives: [],
          loc: { start: 506, end: 524 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'ageInEpochs', loc: { start: 527, end: 538 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 540, end: 543 } },
              loc: { start: 540, end: 543 },
            },
            loc: { start: 540, end: 544 },
          },
          directives: [],
          loc: { start: 527, end: 544 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'indexingRewards', loc: { start: 547, end: 562 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 564, end: 570 } },
              loc: { start: 564, end: 570 },
            },
            loc: { start: 564, end: 571 },
          },
          directives: [],
          loc: { start: 547, end: 571 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'queryFeesCollected',
            loc: { start: 574, end: 592 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 594, end: 600 } },
              loc: { start: 594, end: 600 },
            },
            loc: { start: 594, end: 601 },
          },
          directives: [],
          loc: { start: 574, end: 601 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'signalledTokens', loc: { start: 604, end: 619 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'BigInt', loc: { start: 621, end: 627 } },
              loc: { start: 621, end: 627 },
            },
            loc: { start: 621, end: 628 },
          },
          directives: [],
          loc: { start: 604, end: 628 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'stakedTokens', loc: { start: 631, end: 643 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'BigInt', loc: { start: 645, end: 651 } },
              loc: { start: 645, end: 651 },
            },
            loc: { start: 645, end: 652 },
          },
          directives: [],
          loc: { start: 631, end: 652 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'status', loc: { start: 655, end: 661 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'AllocationStatus',
                loc: { start: 663, end: 679 },
              },
              loc: { start: 663, end: 679 },
            },
            loc: { start: 663, end: 680 },
          },
          directives: [],
          loc: { start: 655, end: 680 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'protocolNetwork', loc: { start: 683, end: 698 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 700, end: 706 } },
              loc: { start: 700, end: 706 },
            },
            loc: { start: 700, end: 707 },
          },
          directives: [],
          loc: { start: 683, end: 707 },
        },
      ],
      loc: { start: 373, end: 709 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: {
        kind: 'Name',
        value: 'CreateAllocationResult',
        loc: { start: 716, end: 738 },
      },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'allocation', loc: { start: 743, end: 753 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 755, end: 761 } },
              loc: { start: 755, end: 761 },
            },
            loc: { start: 755, end: 762 },
          },
          directives: [],
          loc: { start: 743, end: 762 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'deployment', loc: { start: 765, end: 775 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 777, end: 783 } },
              loc: { start: 777, end: 783 },
            },
            loc: { start: 777, end: 784 },
          },
          directives: [],
          loc: { start: 765, end: 784 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'allocatedTokens', loc: { start: 787, end: 802 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 804, end: 810 } },
              loc: { start: 804, end: 810 },
            },
            loc: { start: 804, end: 811 },
          },
          directives: [],
          loc: { start: 787, end: 811 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'protocolNetwork', loc: { start: 814, end: 829 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 831, end: 837 } },
              loc: { start: 831, end: 837 },
            },
            loc: { start: 831, end: 838 },
          },
          directives: [],
          loc: { start: 814, end: 838 },
        },
      ],
      loc: { start: 711, end: 840 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: {
        kind: 'Name',
        value: 'CloseAllocationResult',
        loc: { start: 847, end: 868 },
      },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'allocation', loc: { start: 873, end: 883 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 885, end: 891 } },
              loc: { start: 885, end: 891 },
            },
            loc: { start: 885, end: 892 },
          },
          directives: [],
          loc: { start: 873, end: 892 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'allocatedTokens', loc: { start: 895, end: 910 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 912, end: 918 } },
              loc: { start: 912, end: 918 },
            },
            loc: { start: 912, end: 919 },
          },
          directives: [],
          loc: { start: 895, end: 919 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'indexingRewards', loc: { start: 922, end: 937 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 939, end: 945 } },
              loc: { start: 939, end: 945 },
            },
            loc: { start: 939, end: 946 },
          },
          directives: [],
          loc: { start: 922, end: 946 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'receiptsWorthCollecting',
            loc: { start: 949, end: 972 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Boolean', loc: { start: 974, end: 981 } },
              loc: { start: 974, end: 981 },
            },
            loc: { start: 974, end: 982 },
          },
          directives: [],
          loc: { start: 949, end: 982 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 985, end: 1000 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 1002, end: 1008 } },
              loc: { start: 1002, end: 1008 },
            },
            loc: { start: 1002, end: 1009 },
          },
          directives: [],
          loc: { start: 985, end: 1009 },
        },
      ],
      loc: { start: 842, end: 1011 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: {
        kind: 'Name',
        value: 'ReallocateAllocationResult',
        loc: { start: 1018, end: 1044 },
      },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'closedAllocation',
            loc: { start: 1049, end: 1065 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 1067, end: 1073 } },
              loc: { start: 1067, end: 1073 },
            },
            loc: { start: 1067, end: 1074 },
          },
          directives: [],
          loc: { start: 1049, end: 1074 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'indexingRewardsCollected',
            loc: { start: 1077, end: 1101 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 1103, end: 1109 } },
              loc: { start: 1103, end: 1109 },
            },
            loc: { start: 1103, end: 1110 },
          },
          directives: [],
          loc: { start: 1077, end: 1110 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'receiptsWorthCollecting',
            loc: { start: 1113, end: 1136 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Boolean', loc: { start: 1138, end: 1145 } },
              loc: { start: 1138, end: 1145 },
            },
            loc: { start: 1138, end: 1146 },
          },
          directives: [],
          loc: { start: 1113, end: 1146 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'createdAllocation',
            loc: { start: 1149, end: 1166 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 1168, end: 1174 } },
              loc: { start: 1168, end: 1174 },
            },
            loc: { start: 1168, end: 1175 },
          },
          directives: [],
          loc: { start: 1149, end: 1175 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'createdAllocationStake',
            loc: { start: 1178, end: 1200 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 1202, end: 1208 } },
              loc: { start: 1202, end: 1208 },
            },
            loc: { start: 1202, end: 1209 },
          },
          directives: [],
          loc: { start: 1178, end: 1209 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 1212, end: 1227 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 1229, end: 1235 } },
              loc: { start: 1229, end: 1235 },
            },
            loc: { start: 1229, end: 1236 },
          },
          directives: [],
          loc: { start: 1212, end: 1236 },
        },
      ],
      loc: { start: 1013, end: 1238 },
    },
    {
      kind: 'EnumTypeDefinition',
      name: { kind: 'Name', value: 'ActionStatus', loc: { start: 1245, end: 1257 } },
      directives: [],
      values: [
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'queued', loc: { start: 1262, end: 1268 } },
          directives: [],
          loc: { start: 1262, end: 1268 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'approved', loc: { start: 1271, end: 1279 } },
          directives: [],
          loc: { start: 1271, end: 1279 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'pending', loc: { start: 1282, end: 1289 } },
          directives: [],
          loc: { start: 1282, end: 1289 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'success', loc: { start: 1292, end: 1299 } },
          directives: [],
          loc: { start: 1292, end: 1299 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'failed', loc: { start: 1302, end: 1308 } },
          directives: [],
          loc: { start: 1302, end: 1308 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'canceled', loc: { start: 1311, end: 1319 } },
          directives: [],
          loc: { start: 1311, end: 1319 },
        },
      ],
      loc: { start: 1240, end: 1321 },
    },
    {
      kind: 'EnumTypeDefinition',
      name: { kind: 'Name', value: 'ActionType', loc: { start: 1328, end: 1338 } },
      directives: [],
      values: [
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'allocate', loc: { start: 1343, end: 1351 } },
          directives: [],
          loc: { start: 1343, end: 1351 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'unallocate', loc: { start: 1354, end: 1364 } },
          directives: [],
          loc: { start: 1354, end: 1364 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'reallocate', loc: { start: 1367, end: 1377 } },
          directives: [],
          loc: { start: 1367, end: 1377 },
        },
      ],
      loc: { start: 1323, end: 1379 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'Action', loc: { start: 1386, end: 1392 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'id', loc: { start: 1397, end: 1399 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 1401, end: 1404 } },
              loc: { start: 1401, end: 1404 },
            },
            loc: { start: 1401, end: 1405 },
          },
          directives: [],
          loc: { start: 1397, end: 1405 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'status', loc: { start: 1408, end: 1414 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'ActionStatus',
                loc: { start: 1416, end: 1428 },
              },
              loc: { start: 1416, end: 1428 },
            },
            loc: { start: 1416, end: 1429 },
          },
          directives: [],
          loc: { start: 1408, end: 1429 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'type', loc: { start: 1432, end: 1436 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'ActionType',
                loc: { start: 1438, end: 1448 },
              },
              loc: { start: 1438, end: 1448 },
            },
            loc: { start: 1438, end: 1449 },
          },
          directives: [],
          loc: { start: 1432, end: 1449 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'deploymentID', loc: { start: 1452, end: 1464 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 1466, end: 1472 } },
            loc: { start: 1466, end: 1472 },
          },
          directives: [],
          loc: { start: 1452, end: 1472 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'allocationID', loc: { start: 1475, end: 1487 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 1489, end: 1495 } },
            loc: { start: 1489, end: 1495 },
          },
          directives: [],
          loc: { start: 1475, end: 1495 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'amount', loc: { start: 1498, end: 1504 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 1506, end: 1512 } },
            loc: { start: 1506, end: 1512 },
          },
          directives: [],
          loc: { start: 1498, end: 1512 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'poi', loc: { start: 1515, end: 1518 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 1520, end: 1526 } },
            loc: { start: 1520, end: 1526 },
          },
          directives: [],
          loc: { start: 1515, end: 1526 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'force', loc: { start: 1529, end: 1534 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Boolean', loc: { start: 1536, end: 1543 } },
            loc: { start: 1536, end: 1543 },
          },
          directives: [],
          loc: { start: 1529, end: 1543 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'priority', loc: { start: 1546, end: 1554 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 1556, end: 1559 } },
              loc: { start: 1556, end: 1559 },
            },
            loc: { start: 1556, end: 1560 },
          },
          directives: [],
          loc: { start: 1546, end: 1560 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'source', loc: { start: 1563, end: 1569 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 1571, end: 1577 } },
              loc: { start: 1571, end: 1577 },
            },
            loc: { start: 1571, end: 1578 },
          },
          directives: [],
          loc: { start: 1563, end: 1578 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'reason', loc: { start: 1581, end: 1587 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 1589, end: 1595 } },
              loc: { start: 1589, end: 1595 },
            },
            loc: { start: 1589, end: 1596 },
          },
          directives: [],
          loc: { start: 1581, end: 1596 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'transaction', loc: { start: 1599, end: 1610 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 1612, end: 1618 } },
            loc: { start: 1612, end: 1618 },
          },
          directives: [],
          loc: { start: 1599, end: 1618 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'failureReason', loc: { start: 1621, end: 1634 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 1636, end: 1642 } },
            loc: { start: 1636, end: 1642 },
          },
          directives: [],
          loc: { start: 1621, end: 1642 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'createdAt', loc: { start: 1645, end: 1654 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'BigInt', loc: { start: 1656, end: 1662 } },
              loc: { start: 1656, end: 1662 },
            },
            loc: { start: 1656, end: 1663 },
          },
          directives: [],
          loc: { start: 1645, end: 1663 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'updatedAt', loc: { start: 1666, end: 1675 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'BigInt', loc: { start: 1677, end: 1683 } },
            loc: { start: 1677, end: 1683 },
          },
          directives: [],
          loc: { start: 1666, end: 1683 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 1686, end: 1701 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 1703, end: 1709 } },
              loc: { start: 1703, end: 1709 },
            },
            loc: { start: 1703, end: 1710 },
          },
          directives: [],
          loc: { start: 1686, end: 1710 },
        },
      ],
      loc: { start: 1381, end: 1712 },
    },
    {
      kind: 'InputObjectTypeDefinition',
      name: { kind: 'Name', value: 'ActionInput', loc: { start: 1720, end: 1731 } },
      directives: [],
      fields: [
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'status', loc: { start: 1736, end: 1742 } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'ActionStatus',
                loc: { start: 1744, end: 1756 },
              },
              loc: { start: 1744, end: 1756 },
            },
            loc: { start: 1744, end: 1757 },
          },
          directives: [],
          loc: { start: 1736, end: 1757 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'type', loc: { start: 1760, end: 1764 } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'ActionType',
                loc: { start: 1766, end: 1776 },
              },
              loc: { start: 1766, end: 1776 },
            },
            loc: { start: 1766, end: 1777 },
          },
          directives: [],
          loc: { start: 1760, end: 1777 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'deploymentID', loc: { start: 1780, end: 1792 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 1794, end: 1800 } },
            loc: { start: 1794, end: 1800 },
          },
          directives: [],
          loc: { start: 1780, end: 1800 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'allocationID', loc: { start: 1803, end: 1815 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 1817, end: 1823 } },
            loc: { start: 1817, end: 1823 },
          },
          directives: [],
          loc: { start: 1803, end: 1823 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'amount', loc: { start: 1826, end: 1832 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 1834, end: 1840 } },
            loc: { start: 1834, end: 1840 },
          },
          directives: [],
          loc: { start: 1826, end: 1840 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'poi', loc: { start: 1843, end: 1846 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 1848, end: 1854 } },
            loc: { start: 1848, end: 1854 },
          },
          directives: [],
          loc: { start: 1843, end: 1854 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'force', loc: { start: 1857, end: 1862 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Boolean', loc: { start: 1864, end: 1871 } },
            loc: { start: 1864, end: 1871 },
          },
          directives: [],
          loc: { start: 1857, end: 1871 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'source', loc: { start: 1874, end: 1880 } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 1882, end: 1888 } },
              loc: { start: 1882, end: 1888 },
            },
            loc: { start: 1882, end: 1889 },
          },
          directives: [],
          loc: { start: 1874, end: 1889 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'reason', loc: { start: 1892, end: 1898 } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 1900, end: 1906 } },
              loc: { start: 1900, end: 1906 },
            },
            loc: { start: 1900, end: 1907 },
          },
          directives: [],
          loc: { start: 1892, end: 1907 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'priority', loc: { start: 1910, end: 1918 } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 1920, end: 1923 } },
              loc: { start: 1920, end: 1923 },
            },
            loc: { start: 1920, end: 1924 },
          },
          directives: [],
          loc: { start: 1910, end: 1924 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 1927, end: 1942 },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 1944, end: 1950 } },
              loc: { start: 1944, end: 1950 },
            },
            loc: { start: 1944, end: 1951 },
          },
          directives: [],
          loc: { start: 1927, end: 1951 },
        },
      ],
      loc: { start: 1714, end: 1953 },
    },
    {
      kind: 'InputObjectTypeDefinition',
      name: { kind: 'Name', value: 'ActionUpdateInput', loc: { start: 1961, end: 1978 } },
      directives: [],
      fields: [
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'id', loc: { start: 1983, end: 1985 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Int', loc: { start: 1987, end: 1990 } },
            loc: { start: 1987, end: 1990 },
          },
          directives: [],
          loc: { start: 1983, end: 1990 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'deploymentID', loc: { start: 1993, end: 2005 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 2007, end: 2013 } },
            loc: { start: 2007, end: 2013 },
          },
          directives: [],
          loc: { start: 1993, end: 2013 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'allocationID', loc: { start: 2016, end: 2028 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 2030, end: 2036 } },
            loc: { start: 2030, end: 2036 },
          },
          directives: [],
          loc: { start: 2016, end: 2036 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'amount', loc: { start: 2039, end: 2045 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Int', loc: { start: 2047, end: 2050 } },
            loc: { start: 2047, end: 2050 },
          },
          directives: [],
          loc: { start: 2039, end: 2050 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'poi', loc: { start: 2053, end: 2056 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 2058, end: 2064 } },
            loc: { start: 2058, end: 2064 },
          },
          directives: [],
          loc: { start: 2053, end: 2064 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'force', loc: { start: 2067, end: 2072 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Boolean', loc: { start: 2074, end: 2081 } },
            loc: { start: 2074, end: 2081 },
          },
          directives: [],
          loc: { start: 2067, end: 2081 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'type', loc: { start: 2084, end: 2088 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'ActionType', loc: { start: 2090, end: 2100 } },
            loc: { start: 2090, end: 2100 },
          },
          directives: [],
          loc: { start: 2084, end: 2100 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'status', loc: { start: 2103, end: 2109 } },
          type: {
            kind: 'NamedType',
            name: {
              kind: 'Name',
              value: 'ActionStatus',
              loc: { start: 2111, end: 2123 },
            },
            loc: { start: 2111, end: 2123 },
          },
          directives: [],
          loc: { start: 2103, end: 2123 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'reason', loc: { start: 2126, end: 2132 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 2134, end: 2140 } },
            loc: { start: 2134, end: 2140 },
          },
          directives: [],
          loc: { start: 2126, end: 2140 },
        },
      ],
      loc: { start: 1955, end: 2142 },
    },
    {
      kind: 'EnumTypeDefinition',
      name: { kind: 'Name', value: 'ActionParams', loc: { start: 2149, end: 2161 } },
      directives: [],
      values: [
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'id', loc: { start: 2166, end: 2168 } },
          directives: [],
          loc: { start: 2166, end: 2168 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'status', loc: { start: 2171, end: 2177 } },
          directives: [],
          loc: { start: 2171, end: 2177 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'type', loc: { start: 2180, end: 2184 } },
          directives: [],
          loc: { start: 2180, end: 2184 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'deploymentID', loc: { start: 2187, end: 2199 } },
          directives: [],
          loc: { start: 2187, end: 2199 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'allocationID', loc: { start: 2202, end: 2214 } },
          directives: [],
          loc: { start: 2202, end: 2214 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'transaction', loc: { start: 2217, end: 2228 } },
          directives: [],
          loc: { start: 2217, end: 2228 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'amount', loc: { start: 2231, end: 2237 } },
          directives: [],
          loc: { start: 2231, end: 2237 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'poi', loc: { start: 2240, end: 2243 } },
          directives: [],
          loc: { start: 2240, end: 2243 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'force', loc: { start: 2246, end: 2251 } },
          directives: [],
          loc: { start: 2246, end: 2251 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'source', loc: { start: 2254, end: 2260 } },
          directives: [],
          loc: { start: 2254, end: 2260 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'reason', loc: { start: 2263, end: 2269 } },
          directives: [],
          loc: { start: 2263, end: 2269 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'priority', loc: { start: 2272, end: 2280 } },
          directives: [],
          loc: { start: 2272, end: 2280 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'createdAt', loc: { start: 2283, end: 2292 } },
          directives: [],
          loc: { start: 2283, end: 2292 },
        },
        {
          kind: 'EnumValueDefinition',
          name: { kind: 'Name', value: 'updatedAt', loc: { start: 2295, end: 2304 } },
          directives: [],
          loc: { start: 2295, end: 2304 },
        },
        {
          kind: 'EnumValueDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 2307, end: 2322 },
          },
          directives: [],
          loc: { start: 2307, end: 2322 },
        },
      ],
      loc: { start: 2144, end: 2324 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'ActionResult', loc: { start: 2331, end: 2343 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'id', loc: { start: 2348, end: 2350 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 2352, end: 2355 } },
              loc: { start: 2352, end: 2355 },
            },
            loc: { start: 2352, end: 2356 },
          },
          directives: [],
          loc: { start: 2348, end: 2356 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'type', loc: { start: 2359, end: 2363 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'ActionType',
                loc: { start: 2365, end: 2375 },
              },
              loc: { start: 2365, end: 2375 },
            },
            loc: { start: 2365, end: 2376 },
          },
          directives: [],
          loc: { start: 2359, end: 2376 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'deploymentID', loc: { start: 2379, end: 2391 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 2393, end: 2399 } },
            loc: { start: 2393, end: 2399 },
          },
          directives: [],
          loc: { start: 2379, end: 2399 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'allocationID', loc: { start: 2402, end: 2414 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 2416, end: 2422 } },
            loc: { start: 2416, end: 2422 },
          },
          directives: [],
          loc: { start: 2402, end: 2422 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'amount', loc: { start: 2425, end: 2431 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 2433, end: 2439 } },
            loc: { start: 2433, end: 2439 },
          },
          directives: [],
          loc: { start: 2425, end: 2439 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'poi', loc: { start: 2442, end: 2445 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 2447, end: 2453 } },
            loc: { start: 2447, end: 2453 },
          },
          directives: [],
          loc: { start: 2442, end: 2453 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'force', loc: { start: 2456, end: 2461 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Boolean', loc: { start: 2463, end: 2470 } },
            loc: { start: 2463, end: 2470 },
          },
          directives: [],
          loc: { start: 2456, end: 2470 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'source', loc: { start: 2473, end: 2479 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 2481, end: 2487 } },
              loc: { start: 2481, end: 2487 },
            },
            loc: { start: 2481, end: 2488 },
          },
          directives: [],
          loc: { start: 2473, end: 2488 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'reason', loc: { start: 2491, end: 2497 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 2499, end: 2505 } },
              loc: { start: 2499, end: 2505 },
            },
            loc: { start: 2499, end: 2506 },
          },
          directives: [],
          loc: { start: 2491, end: 2506 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'status', loc: { start: 2509, end: 2515 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 2517, end: 2523 } },
              loc: { start: 2517, end: 2523 },
            },
            loc: { start: 2517, end: 2524 },
          },
          directives: [],
          loc: { start: 2509, end: 2524 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'transaction', loc: { start: 2527, end: 2538 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 2540, end: 2546 } },
            loc: { start: 2540, end: 2546 },
          },
          directives: [],
          loc: { start: 2527, end: 2546 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'failureReason', loc: { start: 2549, end: 2562 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 2564, end: 2570 } },
            loc: { start: 2564, end: 2570 },
          },
          directives: [],
          loc: { start: 2549, end: 2570 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'priority', loc: { start: 2573, end: 2581 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Int', loc: { start: 2583, end: 2586 } },
            loc: { start: 2583, end: 2586 },
          },
          directives: [],
          loc: { start: 2573, end: 2586 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 2589, end: 2604 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 2606, end: 2612 } },
              loc: { start: 2606, end: 2612 },
            },
            loc: { start: 2606, end: 2613 },
          },
          directives: [],
          loc: { start: 2589, end: 2613 },
        },
      ],
      loc: { start: 2326, end: 2615 },
    },
    {
      kind: 'InputObjectTypeDefinition',
      name: { kind: 'Name', value: 'ActionFilter', loc: { start: 2623, end: 2635 } },
      directives: [],
      fields: [
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'id', loc: { start: 2640, end: 2642 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Int', loc: { start: 2644, end: 2647 } },
            loc: { start: 2644, end: 2647 },
          },
          directives: [],
          loc: { start: 2640, end: 2647 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 2650, end: 2665 },
          },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 2667, end: 2673 } },
            loc: { start: 2667, end: 2673 },
          },
          directives: [],
          loc: { start: 2650, end: 2673 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'type', loc: { start: 2676, end: 2680 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'ActionType', loc: { start: 2682, end: 2692 } },
            loc: { start: 2682, end: 2692 },
          },
          directives: [],
          loc: { start: 2676, end: 2692 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'status', loc: { start: 2695, end: 2701 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 2703, end: 2709 } },
            loc: { start: 2703, end: 2709 },
          },
          directives: [],
          loc: { start: 2695, end: 2709 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'source', loc: { start: 2712, end: 2718 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 2720, end: 2726 } },
            loc: { start: 2720, end: 2726 },
          },
          directives: [],
          loc: { start: 2712, end: 2726 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'reason', loc: { start: 2729, end: 2735 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 2737, end: 2743 } },
            loc: { start: 2737, end: 2743 },
          },
          directives: [],
          loc: { start: 2729, end: 2743 },
        },
      ],
      loc: { start: 2617, end: 2745 },
    },
    {
      kind: 'InputObjectTypeDefinition',
      name: {
        kind: 'Name',
        value: 'POIDisputeIdentifier',
        loc: { start: 2753, end: 2773 },
      },
      directives: [],
      fields: [
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'allocationID', loc: { start: 2778, end: 2790 } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 2792, end: 2798 } },
              loc: { start: 2792, end: 2798 },
            },
            loc: { start: 2792, end: 2799 },
          },
          directives: [],
          loc: { start: 2778, end: 2799 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 2802, end: 2817 },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 2819, end: 2825 } },
              loc: { start: 2819, end: 2825 },
            },
            loc: { start: 2819, end: 2826 },
          },
          directives: [],
          loc: { start: 2802, end: 2826 },
        },
      ],
      loc: { start: 2747, end: 2828 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'POIDispute', loc: { start: 2835, end: 2845 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'allocationID', loc: { start: 2850, end: 2862 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 2864, end: 2870 } },
              loc: { start: 2864, end: 2870 },
            },
            loc: { start: 2864, end: 2871 },
          },
          directives: [],
          loc: { start: 2850, end: 2871 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'subgraphDeploymentID',
            loc: { start: 2874, end: 2894 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 2896, end: 2902 } },
              loc: { start: 2896, end: 2902 },
            },
            loc: { start: 2896, end: 2903 },
          },
          directives: [],
          loc: { start: 2874, end: 2903 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'allocationIndexer',
            loc: { start: 2906, end: 2923 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 2925, end: 2931 } },
              loc: { start: 2925, end: 2931 },
            },
            loc: { start: 2925, end: 2932 },
          },
          directives: [],
          loc: { start: 2906, end: 2932 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'allocationAmount',
            loc: { start: 2935, end: 2951 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'BigInt', loc: { start: 2953, end: 2959 } },
              loc: { start: 2953, end: 2959 },
            },
            loc: { start: 2953, end: 2960 },
          },
          directives: [],
          loc: { start: 2935, end: 2960 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'allocationProof',
            loc: { start: 2963, end: 2978 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 2980, end: 2986 } },
              loc: { start: 2980, end: 2986 },
            },
            loc: { start: 2980, end: 2987 },
          },
          directives: [],
          loc: { start: 2963, end: 2987 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'closedEpoch', loc: { start: 2990, end: 3001 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 3003, end: 3006 } },
              loc: { start: 3003, end: 3006 },
            },
            loc: { start: 3003, end: 3007 },
          },
          directives: [],
          loc: { start: 2990, end: 3007 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'closedEpochStartBlockHash',
            loc: { start: 3010, end: 3035 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 3037, end: 3043 } },
              loc: { start: 3037, end: 3043 },
            },
            loc: { start: 3037, end: 3044 },
          },
          directives: [],
          loc: { start: 3010, end: 3044 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'closedEpochStartBlockNumber',
            loc: { start: 3047, end: 3074 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 3076, end: 3079 } },
              loc: { start: 3076, end: 3079 },
            },
            loc: { start: 3076, end: 3080 },
          },
          directives: [],
          loc: { start: 3047, end: 3080 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'closedEpochReferenceProof',
            loc: { start: 3083, end: 3108 },
          },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 3110, end: 3116 } },
            loc: { start: 3110, end: 3116 },
          },
          directives: [],
          loc: { start: 3083, end: 3116 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'previousEpochStartBlockHash',
            loc: { start: 3119, end: 3146 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 3148, end: 3154 } },
              loc: { start: 3148, end: 3154 },
            },
            loc: { start: 3148, end: 3155 },
          },
          directives: [],
          loc: { start: 3119, end: 3155 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'previousEpochStartBlockNumber',
            loc: { start: 3158, end: 3187 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 3189, end: 3192 } },
              loc: { start: 3189, end: 3192 },
            },
            loc: { start: 3189, end: 3193 },
          },
          directives: [],
          loc: { start: 3158, end: 3193 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'previousEpochReferenceProof',
            loc: { start: 3196, end: 3223 },
          },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 3225, end: 3231 } },
            loc: { start: 3225, end: 3231 },
          },
          directives: [],
          loc: { start: 3196, end: 3231 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'status', loc: { start: 3234, end: 3240 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 3242, end: 3248 } },
              loc: { start: 3242, end: 3248 },
            },
            loc: { start: 3242, end: 3249 },
          },
          directives: [],
          loc: { start: 3234, end: 3249 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 3252, end: 3267 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 3269, end: 3275 } },
              loc: { start: 3269, end: 3275 },
            },
            loc: { start: 3269, end: 3276 },
          },
          directives: [],
          loc: { start: 3252, end: 3276 },
        },
      ],
      loc: { start: 2830, end: 3278 },
    },
    {
      kind: 'InputObjectTypeDefinition',
      name: { kind: 'Name', value: 'POIDisputeInput', loc: { start: 3286, end: 3301 } },
      directives: [],
      fields: [
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'allocationID', loc: { start: 3306, end: 3318 } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 3320, end: 3326 } },
              loc: { start: 3320, end: 3326 },
            },
            loc: { start: 3320, end: 3327 },
          },
          directives: [],
          loc: { start: 3306, end: 3327 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'subgraphDeploymentID',
            loc: { start: 3330, end: 3350 },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 3352, end: 3358 } },
              loc: { start: 3352, end: 3358 },
            },
            loc: { start: 3352, end: 3359 },
          },
          directives: [],
          loc: { start: 3330, end: 3359 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'allocationIndexer',
            loc: { start: 3362, end: 3379 },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 3381, end: 3387 } },
              loc: { start: 3381, end: 3387 },
            },
            loc: { start: 3381, end: 3388 },
          },
          directives: [],
          loc: { start: 3362, end: 3388 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'allocationAmount',
            loc: { start: 3391, end: 3407 },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'BigInt', loc: { start: 3409, end: 3415 } },
              loc: { start: 3409, end: 3415 },
            },
            loc: { start: 3409, end: 3416 },
          },
          directives: [],
          loc: { start: 3391, end: 3416 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'allocationProof',
            loc: { start: 3419, end: 3434 },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 3436, end: 3442 } },
              loc: { start: 3436, end: 3442 },
            },
            loc: { start: 3436, end: 3443 },
          },
          directives: [],
          loc: { start: 3419, end: 3443 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'closedEpoch', loc: { start: 3446, end: 3457 } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 3459, end: 3462 } },
              loc: { start: 3459, end: 3462 },
            },
            loc: { start: 3459, end: 3463 },
          },
          directives: [],
          loc: { start: 3446, end: 3463 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'closedEpochStartBlockHash',
            loc: { start: 3466, end: 3491 },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 3493, end: 3499 } },
              loc: { start: 3493, end: 3499 },
            },
            loc: { start: 3493, end: 3500 },
          },
          directives: [],
          loc: { start: 3466, end: 3500 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'closedEpochStartBlockNumber',
            loc: { start: 3503, end: 3530 },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 3532, end: 3535 } },
              loc: { start: 3532, end: 3535 },
            },
            loc: { start: 3532, end: 3536 },
          },
          directives: [],
          loc: { start: 3503, end: 3536 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'closedEpochReferenceProof',
            loc: { start: 3539, end: 3564 },
          },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 3566, end: 3572 } },
            loc: { start: 3566, end: 3572 },
          },
          directives: [],
          loc: { start: 3539, end: 3572 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'previousEpochStartBlockHash',
            loc: { start: 3575, end: 3602 },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 3604, end: 3610 } },
              loc: { start: 3604, end: 3610 },
            },
            loc: { start: 3604, end: 3611 },
          },
          directives: [],
          loc: { start: 3575, end: 3611 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'previousEpochStartBlockNumber',
            loc: { start: 3614, end: 3643 },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 3645, end: 3648 } },
              loc: { start: 3645, end: 3648 },
            },
            loc: { start: 3645, end: 3649 },
          },
          directives: [],
          loc: { start: 3614, end: 3649 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'previousEpochReferenceProof',
            loc: { start: 3652, end: 3679 },
          },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 3681, end: 3687 } },
            loc: { start: 3681, end: 3687 },
          },
          directives: [],
          loc: { start: 3652, end: 3687 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'status', loc: { start: 3690, end: 3696 } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 3698, end: 3704 } },
              loc: { start: 3698, end: 3704 },
            },
            loc: { start: 3698, end: 3705 },
          },
          directives: [],
          loc: { start: 3690, end: 3705 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 3708, end: 3723 },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 3725, end: 3731 } },
              loc: { start: 3725, end: 3731 },
            },
            loc: { start: 3725, end: 3732 },
          },
          directives: [],
          loc: { start: 3708, end: 3732 },
        },
      ],
      loc: { start: 3280, end: 3734 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'IndexingRule', loc: { start: 3741, end: 3753 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'identifier', loc: { start: 3758, end: 3768 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 3770, end: 3776 } },
              loc: { start: 3770, end: 3776 },
            },
            loc: { start: 3770, end: 3777 },
          },
          directives: [],
          loc: { start: 3758, end: 3777 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'identifierType',
            loc: { start: 3780, end: 3794 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'IdentifierType',
                loc: { start: 3796, end: 3810 },
              },
              loc: { start: 3796, end: 3810 },
            },
            loc: { start: 3796, end: 3811 },
          },
          directives: [],
          loc: { start: 3780, end: 3811 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'allocationAmount',
            loc: { start: 3814, end: 3830 },
          },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'BigInt', loc: { start: 3832, end: 3838 } },
            loc: { start: 3832, end: 3838 },
          },
          directives: [],
          loc: { start: 3814, end: 3838 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'allocationLifetime',
            loc: { start: 3841, end: 3859 },
          },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Int', loc: { start: 3861, end: 3864 } },
            loc: { start: 3861, end: 3864 },
          },
          directives: [],
          loc: { start: 3841, end: 3864 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'autoRenewal', loc: { start: 3867, end: 3878 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Boolean', loc: { start: 3880, end: 3887 } },
              loc: { start: 3880, end: 3887 },
            },
            loc: { start: 3880, end: 3888 },
          },
          directives: [],
          loc: { start: 3867, end: 3888 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'parallelAllocations',
            loc: { start: 3891, end: 3910 },
          },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Int', loc: { start: 3912, end: 3915 } },
            loc: { start: 3912, end: 3915 },
          },
          directives: [],
          loc: { start: 3891, end: 3915 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'maxAllocationPercentage',
            loc: { start: 3918, end: 3941 },
          },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Float', loc: { start: 3943, end: 3948 } },
            loc: { start: 3943, end: 3948 },
          },
          directives: [],
          loc: { start: 3918, end: 3948 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'minSignal', loc: { start: 3951, end: 3960 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'BigInt', loc: { start: 3962, end: 3968 } },
            loc: { start: 3962, end: 3968 },
          },
          directives: [],
          loc: { start: 3951, end: 3968 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'maxSignal', loc: { start: 3971, end: 3980 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'BigInt', loc: { start: 3982, end: 3988 } },
            loc: { start: 3982, end: 3988 },
          },
          directives: [],
          loc: { start: 3971, end: 3988 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'minStake', loc: { start: 3991, end: 3999 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'BigInt', loc: { start: 4001, end: 4007 } },
            loc: { start: 4001, end: 4007 },
          },
          directives: [],
          loc: { start: 3991, end: 4007 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'minAverageQueryFees',
            loc: { start: 4010, end: 4029 },
          },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'BigInt', loc: { start: 4031, end: 4037 } },
            loc: { start: 4031, end: 4037 },
          },
          directives: [],
          loc: { start: 4010, end: 4037 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'custom', loc: { start: 4040, end: 4046 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 4048, end: 4054 } },
            loc: { start: 4048, end: 4054 },
          },
          directives: [],
          loc: { start: 4040, end: 4054 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'decisionBasis', loc: { start: 4057, end: 4070 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'IndexingDecisionBasis',
                loc: { start: 4072, end: 4093 },
              },
              loc: { start: 4072, end: 4093 },
            },
            loc: { start: 4072, end: 4094 },
          },
          directives: [],
          loc: { start: 4057, end: 4094 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'requireSupported',
            loc: { start: 4097, end: 4113 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Boolean', loc: { start: 4115, end: 4122 } },
              loc: { start: 4115, end: 4122 },
            },
            loc: { start: 4115, end: 4123 },
          },
          directives: [],
          loc: { start: 4097, end: 4123 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'safety', loc: { start: 4126, end: 4132 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Boolean', loc: { start: 4134, end: 4141 } },
              loc: { start: 4134, end: 4141 },
            },
            loc: { start: 4134, end: 4142 },
          },
          directives: [],
          loc: { start: 4126, end: 4142 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 4145, end: 4160 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 4162, end: 4168 } },
              loc: { start: 4162, end: 4168 },
            },
            loc: { start: 4162, end: 4169 },
          },
          directives: [],
          loc: { start: 4145, end: 4169 },
        },
      ],
      loc: { start: 3736, end: 4171 },
    },
    {
      kind: 'InputObjectTypeDefinition',
      name: { kind: 'Name', value: 'IndexingRuleInput', loc: { start: 4179, end: 4196 } },
      directives: [],
      fields: [
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'identifier', loc: { start: 4201, end: 4211 } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 4213, end: 4219 } },
              loc: { start: 4213, end: 4219 },
            },
            loc: { start: 4213, end: 4220 },
          },
          directives: [],
          loc: { start: 4201, end: 4220 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'identifierType',
            loc: { start: 4223, end: 4237 },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'IdentifierType',
                loc: { start: 4239, end: 4253 },
              },
              loc: { start: 4239, end: 4253 },
            },
            loc: { start: 4239, end: 4254 },
          },
          directives: [],
          loc: { start: 4223, end: 4254 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'allocationAmount',
            loc: { start: 4257, end: 4273 },
          },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'BigInt', loc: { start: 4275, end: 4281 } },
            loc: { start: 4275, end: 4281 },
          },
          directives: [],
          loc: { start: 4257, end: 4281 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'allocationLifetime',
            loc: { start: 4284, end: 4302 },
          },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Int', loc: { start: 4304, end: 4307 } },
            loc: { start: 4304, end: 4307 },
          },
          directives: [],
          loc: { start: 4284, end: 4307 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'autoRenewal', loc: { start: 4310, end: 4321 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Boolean', loc: { start: 4323, end: 4330 } },
            loc: { start: 4323, end: 4330 },
          },
          directives: [],
          loc: { start: 4310, end: 4330 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'parallelAllocations',
            loc: { start: 4333, end: 4352 },
          },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Int', loc: { start: 4354, end: 4357 } },
            loc: { start: 4354, end: 4357 },
          },
          directives: [],
          loc: { start: 4333, end: 4357 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'maxAllocationPercentage',
            loc: { start: 4360, end: 4383 },
          },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Float', loc: { start: 4385, end: 4390 } },
            loc: { start: 4385, end: 4390 },
          },
          directives: [],
          loc: { start: 4360, end: 4390 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'minSignal', loc: { start: 4393, end: 4402 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'BigInt', loc: { start: 4404, end: 4410 } },
            loc: { start: 4404, end: 4410 },
          },
          directives: [],
          loc: { start: 4393, end: 4410 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'maxSignal', loc: { start: 4413, end: 4422 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'BigInt', loc: { start: 4424, end: 4430 } },
            loc: { start: 4424, end: 4430 },
          },
          directives: [],
          loc: { start: 4413, end: 4430 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'minStake', loc: { start: 4433, end: 4441 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'BigInt', loc: { start: 4443, end: 4449 } },
            loc: { start: 4443, end: 4449 },
          },
          directives: [],
          loc: { start: 4433, end: 4449 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'minAverageQueryFees',
            loc: { start: 4452, end: 4471 },
          },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'BigInt', loc: { start: 4473, end: 4479 } },
            loc: { start: 4473, end: 4479 },
          },
          directives: [],
          loc: { start: 4452, end: 4479 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'custom', loc: { start: 4482, end: 4488 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 4490, end: 4496 } },
            loc: { start: 4490, end: 4496 },
          },
          directives: [],
          loc: { start: 4482, end: 4496 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'decisionBasis', loc: { start: 4499, end: 4512 } },
          type: {
            kind: 'NamedType',
            name: {
              kind: 'Name',
              value: 'IndexingDecisionBasis',
              loc: { start: 4514, end: 4535 },
            },
            loc: { start: 4514, end: 4535 },
          },
          directives: [],
          loc: { start: 4499, end: 4535 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'requireSupported',
            loc: { start: 4538, end: 4554 },
          },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Boolean', loc: { start: 4556, end: 4563 } },
            loc: { start: 4556, end: 4563 },
          },
          directives: [],
          loc: { start: 4538, end: 4563 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'safety', loc: { start: 4566, end: 4572 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Boolean', loc: { start: 4574, end: 4581 } },
            loc: { start: 4574, end: 4581 },
          },
          directives: [],
          loc: { start: 4566, end: 4581 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 4584, end: 4599 },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 4601, end: 4607 } },
              loc: { start: 4601, end: 4607 },
            },
            loc: { start: 4601, end: 4608 },
          },
          directives: [],
          loc: { start: 4584, end: 4608 },
        },
      ],
      loc: { start: 4173, end: 4610 },
    },
    {
      kind: 'InputObjectTypeDefinition',
      name: {
        kind: 'Name',
        value: 'IndexingRuleIdentifier',
        loc: { start: 4618, end: 4640 },
      },
      directives: [],
      fields: [
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'identifier', loc: { start: 4645, end: 4655 } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 4657, end: 4663 } },
              loc: { start: 4657, end: 4663 },
            },
            loc: { start: 4657, end: 4664 },
          },
          directives: [],
          loc: { start: 4645, end: 4664 },
        },
        {
          kind: 'InputValueDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 4667, end: 4682 },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 4684, end: 4690 } },
              loc: { start: 4684, end: 4690 },
            },
            loc: { start: 4684, end: 4691 },
          },
          directives: [],
          loc: { start: 4667, end: 4691 },
        },
      ],
      loc: { start: 4612, end: 4693 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'GeoLocation', loc: { start: 4700, end: 4711 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'latitude', loc: { start: 4716, end: 4724 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 4726, end: 4732 } },
              loc: { start: 4726, end: 4732 },
            },
            loc: { start: 4726, end: 4733 },
          },
          directives: [],
          loc: { start: 4716, end: 4733 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'longitude', loc: { start: 4736, end: 4745 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 4747, end: 4753 } },
              loc: { start: 4747, end: 4753 },
            },
            loc: { start: 4747, end: 4754 },
          },
          directives: [],
          loc: { start: 4736, end: 4754 },
        },
      ],
      loc: { start: 4695, end: 4756 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: {
        kind: 'Name',
        value: 'IndexerRegistration',
        loc: { start: 4763, end: 4782 },
      },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'url', loc: { start: 4787, end: 4790 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 4792, end: 4798 } },
            loc: { start: 4792, end: 4798 },
          },
          directives: [],
          loc: { start: 4787, end: 4798 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 4801, end: 4816 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 4818, end: 4824 } },
              loc: { start: 4818, end: 4824 },
            },
            loc: { start: 4818, end: 4825 },
          },
          directives: [],
          loc: { start: 4801, end: 4825 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'address', loc: { start: 4828, end: 4835 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 4837, end: 4843 } },
            loc: { start: 4837, end: 4843 },
          },
          directives: [],
          loc: { start: 4828, end: 4843 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'registered', loc: { start: 4846, end: 4856 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Boolean', loc: { start: 4858, end: 4865 } },
              loc: { start: 4858, end: 4865 },
            },
            loc: { start: 4858, end: 4866 },
          },
          directives: [],
          loc: { start: 4846, end: 4866 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'location', loc: { start: 4869, end: 4877 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'GeoLocation', loc: { start: 4879, end: 4890 } },
            loc: { start: 4879, end: 4890 },
          },
          directives: [],
          loc: { start: 4869, end: 4890 },
        },
      ],
      loc: { start: 4758, end: 4892 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'IndexingError', loc: { start: 4899, end: 4912 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'handler', loc: { start: 4917, end: 4924 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 4926, end: 4932 } },
            loc: { start: 4926, end: 4932 },
          },
          directives: [],
          loc: { start: 4917, end: 4932 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'message', loc: { start: 4935, end: 4942 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 4944, end: 4950 } },
              loc: { start: 4944, end: 4950 },
            },
            loc: { start: 4944, end: 4951 },
          },
          directives: [],
          loc: { start: 4935, end: 4951 },
        },
      ],
      loc: { start: 4894, end: 4953 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'BlockPointer', loc: { start: 4960, end: 4972 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'number', loc: { start: 4977, end: 4983 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 4985, end: 4988 } },
              loc: { start: 4985, end: 4988 },
            },
            loc: { start: 4985, end: 4989 },
          },
          directives: [],
          loc: { start: 4977, end: 4989 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'hash', loc: { start: 4992, end: 4996 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 4998, end: 5004 } },
              loc: { start: 4998, end: 5004 },
            },
            loc: { start: 4998, end: 5005 },
          },
          directives: [],
          loc: { start: 4992, end: 5005 },
        },
      ],
      loc: { start: 4955, end: 5007 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: {
        kind: 'Name',
        value: 'ChainIndexingStatus',
        loc: { start: 5014, end: 5033 },
      },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'network', loc: { start: 5038, end: 5045 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 5047, end: 5053 } },
              loc: { start: 5047, end: 5053 },
            },
            loc: { start: 5047, end: 5054 },
          },
          directives: [],
          loc: { start: 5038, end: 5054 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'latestBlock', loc: { start: 5057, end: 5068 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: {
              kind: 'Name',
              value: 'BlockPointer',
              loc: { start: 5070, end: 5082 },
            },
            loc: { start: 5070, end: 5082 },
          },
          directives: [],
          loc: { start: 5057, end: 5082 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'chainHeadBlock',
            loc: { start: 5085, end: 5099 },
          },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: {
              kind: 'Name',
              value: 'BlockPointer',
              loc: { start: 5101, end: 5113 },
            },
            loc: { start: 5101, end: 5113 },
          },
          directives: [],
          loc: { start: 5085, end: 5113 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'earliestBlock', loc: { start: 5116, end: 5129 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: {
              kind: 'Name',
              value: 'BlockPointer',
              loc: { start: 5131, end: 5143 },
            },
            loc: { start: 5131, end: 5143 },
          },
          directives: [],
          loc: { start: 5116, end: 5143 },
        },
      ],
      loc: { start: 5009, end: 5145 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'IndexerDeployment', loc: { start: 5152, end: 5169 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'subgraphDeployment',
            loc: { start: 5174, end: 5192 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 5194, end: 5200 } },
              loc: { start: 5194, end: 5200 },
            },
            loc: { start: 5194, end: 5201 },
          },
          directives: [],
          loc: { start: 5174, end: 5201 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'synced', loc: { start: 5204, end: 5210 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Boolean', loc: { start: 5212, end: 5219 } },
              loc: { start: 5212, end: 5219 },
            },
            loc: { start: 5212, end: 5220 },
          },
          directives: [],
          loc: { start: 5204, end: 5220 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'health', loc: { start: 5223, end: 5229 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 5231, end: 5237 } },
              loc: { start: 5231, end: 5237 },
            },
            loc: { start: 5231, end: 5238 },
          },
          directives: [],
          loc: { start: 5223, end: 5238 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'fatalError', loc: { start: 5241, end: 5251 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: {
              kind: 'Name',
              value: 'IndexingError',
              loc: { start: 5253, end: 5266 },
            },
            loc: { start: 5253, end: 5266 },
          },
          directives: [],
          loc: { start: 5241, end: 5266 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'node', loc: { start: 5269, end: 5273 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 5275, end: 5281 } },
            loc: { start: 5275, end: 5281 },
          },
          directives: [],
          loc: { start: 5269, end: 5281 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'chains', loc: { start: 5284, end: 5290 } },
          arguments: [],
          type: {
            kind: 'ListType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'ChainIndexingStatus',
                loc: { start: 5293, end: 5312 },
              },
              loc: { start: 5293, end: 5312 },
            },
            loc: { start: 5292, end: 5313 },
          },
          directives: [],
          loc: { start: 5284, end: 5313 },
        },
      ],
      loc: { start: 5147, end: 5315 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'IndexerAllocation', loc: { start: 5322, end: 5339 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'id', loc: { start: 5344, end: 5346 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 5348, end: 5354 } },
              loc: { start: 5348, end: 5354 },
            },
            loc: { start: 5348, end: 5355 },
          },
          directives: [],
          loc: { start: 5344, end: 5355 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'allocatedTokens',
            loc: { start: 5358, end: 5373 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'BigInt', loc: { start: 5375, end: 5381 } },
              loc: { start: 5375, end: 5381 },
            },
            loc: { start: 5375, end: 5382 },
          },
          directives: [],
          loc: { start: 5358, end: 5382 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'createdAtEpoch',
            loc: { start: 5385, end: 5399 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 5401, end: 5404 } },
              loc: { start: 5401, end: 5404 },
            },
            loc: { start: 5401, end: 5405 },
          },
          directives: [],
          loc: { start: 5385, end: 5405 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'closedAtEpoch', loc: { start: 5408, end: 5421 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Int', loc: { start: 5423, end: 5426 } },
            loc: { start: 5423, end: 5426 },
          },
          directives: [],
          loc: { start: 5408, end: 5426 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'subgraphDeployment',
            loc: { start: 5429, end: 5447 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 5449, end: 5455 } },
              loc: { start: 5449, end: 5455 },
            },
            loc: { start: 5449, end: 5456 },
          },
          directives: [],
          loc: { start: 5429, end: 5456 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'signalledTokens',
            loc: { start: 5459, end: 5474 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'BigInt', loc: { start: 5476, end: 5482 } },
              loc: { start: 5476, end: 5482 },
            },
            loc: { start: 5476, end: 5483 },
          },
          directives: [],
          loc: { start: 5459, end: 5483 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'stakedTokens', loc: { start: 5486, end: 5498 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'BigInt', loc: { start: 5500, end: 5506 } },
              loc: { start: 5500, end: 5506 },
            },
            loc: { start: 5500, end: 5507 },
          },
          directives: [],
          loc: { start: 5486, end: 5507 },
        },
      ],
      loc: { start: 5317, end: 5509 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: {
        kind: 'Name',
        value: 'IndexerEndpointTest',
        loc: { start: 5516, end: 5535 },
      },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'test', loc: { start: 5540, end: 5544 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 5546, end: 5552 } },
              loc: { start: 5546, end: 5552 },
            },
            loc: { start: 5546, end: 5553 },
          },
          directives: [],
          loc: { start: 5540, end: 5553 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'error', loc: { start: 5556, end: 5561 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 5563, end: 5569 } },
            loc: { start: 5563, end: 5569 },
          },
          directives: [],
          loc: { start: 5556, end: 5569 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'possibleActions',
            loc: { start: 5572, end: 5587 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'String', loc: { start: 5590, end: 5596 } },
                loc: { start: 5590, end: 5596 },
              },
              loc: { start: 5589, end: 5597 },
            },
            loc: { start: 5589, end: 5598 },
          },
          directives: [],
          loc: { start: 5572, end: 5598 },
        },
      ],
      loc: { start: 5511, end: 5600 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'IndexerEndpoint', loc: { start: 5607, end: 5622 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'url', loc: { start: 5627, end: 5630 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 5632, end: 5638 } },
            loc: { start: 5632, end: 5638 },
          },
          directives: [],
          loc: { start: 5627, end: 5638 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'healthy', loc: { start: 5641, end: 5648 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Boolean', loc: { start: 5650, end: 5657 } },
              loc: { start: 5650, end: 5657 },
            },
            loc: { start: 5650, end: 5658 },
          },
          directives: [],
          loc: { start: 5641, end: 5658 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'protocolNetwork',
            loc: { start: 5661, end: 5676 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 5678, end: 5684 } },
              loc: { start: 5678, end: 5684 },
            },
            loc: { start: 5678, end: 5685 },
          },
          directives: [],
          loc: { start: 5661, end: 5685 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'tests', loc: { start: 5688, end: 5693 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'IndexerEndpointTest',
                    loc: { start: 5696, end: 5715 },
                  },
                  loc: { start: 5696, end: 5715 },
                },
                loc: { start: 5696, end: 5716 },
              },
              loc: { start: 5695, end: 5717 },
            },
            loc: { start: 5695, end: 5718 },
          },
          directives: [],
          loc: { start: 5688, end: 5718 },
        },
      ],
      loc: { start: 5602, end: 5720 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'IndexerEndpoints', loc: { start: 5727, end: 5743 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'service', loc: { start: 5748, end: 5755 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'IndexerEndpoint',
                loc: { start: 5757, end: 5772 },
              },
              loc: { start: 5757, end: 5772 },
            },
            loc: { start: 5757, end: 5773 },
          },
          directives: [],
          loc: { start: 5748, end: 5773 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'status', loc: { start: 5776, end: 5782 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'IndexerEndpoint',
                loc: { start: 5784, end: 5799 },
              },
              loc: { start: 5784, end: 5799 },
            },
            loc: { start: 5784, end: 5800 },
          },
          directives: [],
          loc: { start: 5776, end: 5800 },
        },
      ],
      loc: { start: 5722, end: 5802 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'CostModel', loc: { start: 5809, end: 5818 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'deployment', loc: { start: 5823, end: 5833 } },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 5835, end: 5841 } },
              loc: { start: 5835, end: 5841 },
            },
            loc: { start: 5835, end: 5842 },
          },
          directives: [],
          loc: { start: 5823, end: 5842 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'model', loc: { start: 5845, end: 5850 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 5852, end: 5858 } },
            loc: { start: 5852, end: 5858 },
          },
          directives: [],
          loc: { start: 5845, end: 5858 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'variables', loc: { start: 5861, end: 5870 } },
          arguments: [],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 5872, end: 5878 } },
            loc: { start: 5872, end: 5878 },
          },
          directives: [],
          loc: { start: 5861, end: 5878 },
        },
      ],
      loc: { start: 5804, end: 5880 },
    },
    {
      kind: 'InputObjectTypeDefinition',
      name: { kind: 'Name', value: 'CostModelInput', loc: { start: 5888, end: 5902 } },
      directives: [],
      fields: [
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'deployment', loc: { start: 5907, end: 5917 } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String', loc: { start: 5919, end: 5925 } },
              loc: { start: 5919, end: 5925 },
            },
            loc: { start: 5919, end: 5926 },
          },
          directives: [],
          loc: { start: 5907, end: 5926 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'model', loc: { start: 5929, end: 5934 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 5936, end: 5942 } },
            loc: { start: 5936, end: 5942 },
          },
          directives: [],
          loc: { start: 5929, end: 5942 },
        },
        {
          kind: 'InputValueDefinition',
          name: { kind: 'Name', value: 'variables', loc: { start: 5945, end: 5954 } },
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'String', loc: { start: 5956, end: 5962 } },
            loc: { start: 5956, end: 5962 },
          },
          directives: [],
          loc: { start: 5945, end: 5962 },
        },
      ],
      loc: { start: 5882, end: 5964 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'Query', loc: { start: 5971, end: 5976 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'indexingRule', loc: { start: 5981, end: 5993 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'identifier',
                loc: { start: 5994, end: 6004 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'IndexingRuleIdentifier',
                    loc: { start: 6006, end: 6028 },
                  },
                  loc: { start: 6006, end: 6028 },
                },
                loc: { start: 6006, end: 6029 },
              },
              directives: [],
              loc: { start: 5994, end: 6029 },
            },
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'merged', loc: { start: 6031, end: 6037 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'Boolean',
                    loc: { start: 6039, end: 6046 },
                  },
                  loc: { start: 6039, end: 6046 },
                },
                loc: { start: 6039, end: 6047 },
              },
              defaultValue: {
                kind: 'BooleanValue',
                value: false,
                loc: { start: 6050, end: 6055 },
              },
              directives: [],
              loc: { start: 6031, end: 6055 },
            },
          ],
          type: {
            kind: 'NamedType',
            name: {
              kind: 'Name',
              value: 'IndexingRule',
              loc: { start: 6058, end: 6070 },
            },
            loc: { start: 6058, end: 6070 },
          },
          directives: [],
          loc: { start: 5981, end: 6070 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'indexingRules', loc: { start: 6073, end: 6086 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'merged', loc: { start: 6087, end: 6093 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'Boolean',
                    loc: { start: 6095, end: 6102 },
                  },
                  loc: { start: 6095, end: 6102 },
                },
                loc: { start: 6095, end: 6103 },
              },
              defaultValue: {
                kind: 'BooleanValue',
                value: false,
                loc: { start: 6106, end: 6111 },
              },
              directives: [],
              loc: { start: 6087, end: 6111 },
            },
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'protocolNetwork',
                loc: { start: 6113, end: 6128 },
              },
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'String', loc: { start: 6130, end: 6136 } },
                loc: { start: 6130, end: 6136 },
              },
              directives: [],
              loc: { start: 6113, end: 6136 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'IndexingRule',
                    loc: { start: 6140, end: 6152 },
                  },
                  loc: { start: 6140, end: 6152 },
                },
                loc: { start: 6140, end: 6153 },
              },
              loc: { start: 6139, end: 6154 },
            },
            loc: { start: 6139, end: 6155 },
          },
          directives: [],
          loc: { start: 6073, end: 6155 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'indexerRegistration',
            loc: { start: 6158, end: 6177 },
          },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'protocolNetwork',
                loc: { start: 6178, end: 6193 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'String',
                    loc: { start: 6195, end: 6201 },
                  },
                  loc: { start: 6195, end: 6201 },
                },
                loc: { start: 6195, end: 6202 },
              },
              directives: [],
              loc: { start: 6178, end: 6202 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'IndexerRegistration',
                loc: { start: 6205, end: 6224 },
              },
              loc: { start: 6205, end: 6224 },
            },
            loc: { start: 6205, end: 6225 },
          },
          directives: [],
          loc: { start: 6158, end: 6225 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'indexerDeployments',
            loc: { start: 6228, end: 6246 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NamedType',
                name: {
                  kind: 'Name',
                  value: 'IndexerDeployment',
                  loc: { start: 6249, end: 6266 },
                },
                loc: { start: 6249, end: 6266 },
              },
              loc: { start: 6248, end: 6267 },
            },
            loc: { start: 6248, end: 6268 },
          },
          directives: [],
          loc: { start: 6228, end: 6268 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'indexerAllocations',
            loc: { start: 6271, end: 6289 },
          },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'protocolNetwork',
                loc: { start: 6290, end: 6305 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'String',
                    loc: { start: 6307, end: 6313 },
                  },
                  loc: { start: 6307, end: 6313 },
                },
                loc: { start: 6307, end: 6314 },
              },
              directives: [],
              loc: { start: 6290, end: 6314 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NamedType',
                name: {
                  kind: 'Name',
                  value: 'IndexerAllocation',
                  loc: { start: 6318, end: 6335 },
                },
                loc: { start: 6318, end: 6335 },
              },
              loc: { start: 6317, end: 6336 },
            },
            loc: { start: 6317, end: 6337 },
          },
          directives: [],
          loc: { start: 6271, end: 6337 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'indexerEndpoints',
            loc: { start: 6340, end: 6356 },
          },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'protocolNetwork',
                loc: { start: 6357, end: 6372 },
              },
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'String', loc: { start: 6374, end: 6380 } },
                loc: { start: 6374, end: 6380 },
              },
              directives: [],
              loc: { start: 6357, end: 6380 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'IndexerEndpoints',
                    loc: { start: 6384, end: 6400 },
                  },
                  loc: { start: 6384, end: 6400 },
                },
                loc: { start: 6384, end: 6401 },
              },
              loc: { start: 6383, end: 6402 },
            },
            loc: { start: 6383, end: 6403 },
          },
          directives: [],
          loc: { start: 6340, end: 6403 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'costModels', loc: { start: 6406, end: 6416 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'deployments',
                loc: { start: 6417, end: 6428 },
              },
              type: {
                kind: 'ListType',
                type: {
                  kind: 'NonNullType',
                  type: {
                    kind: 'NamedType',
                    name: {
                      kind: 'Name',
                      value: 'String',
                      loc: { start: 6431, end: 6437 },
                    },
                    loc: { start: 6431, end: 6437 },
                  },
                  loc: { start: 6431, end: 6438 },
                },
                loc: { start: 6430, end: 6439 },
              },
              directives: [],
              loc: { start: 6417, end: 6439 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'CostModel',
                    loc: { start: 6443, end: 6452 },
                  },
                  loc: { start: 6443, end: 6452 },
                },
                loc: { start: 6443, end: 6453 },
              },
              loc: { start: 6442, end: 6454 },
            },
            loc: { start: 6442, end: 6455 },
          },
          directives: [],
          loc: { start: 6406, end: 6455 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'costModel', loc: { start: 6458, end: 6467 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'deployment',
                loc: { start: 6468, end: 6478 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'String',
                    loc: { start: 6480, end: 6486 },
                  },
                  loc: { start: 6480, end: 6486 },
                },
                loc: { start: 6480, end: 6487 },
              },
              directives: [],
              loc: { start: 6468, end: 6487 },
            },
          ],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'CostModel', loc: { start: 6490, end: 6499 } },
            loc: { start: 6490, end: 6499 },
          },
          directives: [],
          loc: { start: 6458, end: 6499 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'dispute', loc: { start: 6502, end: 6509 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'identifier',
                loc: { start: 6510, end: 6520 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'POIDisputeIdentifier',
                    loc: { start: 6522, end: 6542 },
                  },
                  loc: { start: 6522, end: 6542 },
                },
                loc: { start: 6522, end: 6543 },
              },
              directives: [],
              loc: { start: 6510, end: 6543 },
            },
          ],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'POIDispute', loc: { start: 6546, end: 6556 } },
            loc: { start: 6546, end: 6556 },
          },
          directives: [],
          loc: { start: 6502, end: 6556 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'disputes', loc: { start: 6559, end: 6567 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'status', loc: { start: 6568, end: 6574 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'String',
                    loc: { start: 6576, end: 6582 },
                  },
                  loc: { start: 6576, end: 6582 },
                },
                loc: { start: 6576, end: 6583 },
              },
              directives: [],
              loc: { start: 6568, end: 6583 },
            },
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'minClosedEpoch',
                loc: { start: 6585, end: 6599 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: { kind: 'Name', value: 'Int', loc: { start: 6601, end: 6604 } },
                  loc: { start: 6601, end: 6604 },
                },
                loc: { start: 6601, end: 6605 },
              },
              directives: [],
              loc: { start: 6585, end: 6605 },
            },
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'protocolNetwork',
                loc: { start: 6607, end: 6622 },
              },
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'String', loc: { start: 6624, end: 6630 } },
                loc: { start: 6624, end: 6630 },
              },
              directives: [],
              loc: { start: 6607, end: 6630 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NamedType',
                name: {
                  kind: 'Name',
                  value: 'POIDispute',
                  loc: { start: 6634, end: 6644 },
                },
                loc: { start: 6634, end: 6644 },
              },
              loc: { start: 6633, end: 6645 },
            },
            loc: { start: 6633, end: 6646 },
          },
          directives: [],
          loc: { start: 6559, end: 6646 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'disputesClosedAfter',
            loc: { start: 6649, end: 6668 },
          },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'closedAfterBlock',
                loc: { start: 6669, end: 6685 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'BigInt',
                    loc: { start: 6687, end: 6693 },
                  },
                  loc: { start: 6687, end: 6693 },
                },
                loc: { start: 6687, end: 6694 },
              },
              directives: [],
              loc: { start: 6669, end: 6694 },
            },
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'protocolNetwork',
                loc: { start: 6696, end: 6711 },
              },
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'String', loc: { start: 6713, end: 6719 } },
                loc: { start: 6713, end: 6719 },
              },
              directives: [],
              loc: { start: 6696, end: 6719 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NamedType',
                name: {
                  kind: 'Name',
                  value: 'POIDispute',
                  loc: { start: 6723, end: 6733 },
                },
                loc: { start: 6723, end: 6733 },
              },
              loc: { start: 6722, end: 6734 },
            },
            loc: { start: 6722, end: 6735 },
          },
          directives: [],
          loc: { start: 6649, end: 6735 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'allocations', loc: { start: 6738, end: 6749 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'filter', loc: { start: 6750, end: 6756 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'AllocationFilter',
                    loc: { start: 6758, end: 6774 },
                  },
                  loc: { start: 6758, end: 6774 },
                },
                loc: { start: 6758, end: 6775 },
              },
              directives: [],
              loc: { start: 6750, end: 6775 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'Allocation',
                    loc: { start: 6779, end: 6789 },
                  },
                  loc: { start: 6779, end: 6789 },
                },
                loc: { start: 6779, end: 6790 },
              },
              loc: { start: 6778, end: 6791 },
            },
            loc: { start: 6778, end: 6792 },
          },
          directives: [],
          loc: { start: 6738, end: 6792 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'action', loc: { start: 6795, end: 6801 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'actionID', loc: { start: 6802, end: 6810 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'String',
                    loc: { start: 6812, end: 6818 },
                  },
                  loc: { start: 6812, end: 6818 },
                },
                loc: { start: 6812, end: 6819 },
              },
              directives: [],
              loc: { start: 6802, end: 6819 },
            },
          ],
          type: {
            kind: 'NamedType',
            name: { kind: 'Name', value: 'Action', loc: { start: 6822, end: 6828 } },
            loc: { start: 6822, end: 6828 },
          },
          directives: [],
          loc: { start: 6795, end: 6828 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'actions', loc: { start: 6831, end: 6838 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'filter', loc: { start: 6839, end: 6845 } },
              type: {
                kind: 'NamedType',
                name: {
                  kind: 'Name',
                  value: 'ActionFilter',
                  loc: { start: 6847, end: 6859 },
                },
                loc: { start: 6847, end: 6859 },
              },
              directives: [],
              loc: { start: 6839, end: 6859 },
            },
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'orderBy', loc: { start: 6861, end: 6868 } },
              type: {
                kind: 'NamedType',
                name: {
                  kind: 'Name',
                  value: 'ActionParams',
                  loc: { start: 6870, end: 6882 },
                },
                loc: { start: 6870, end: 6882 },
              },
              directives: [],
              loc: { start: 6861, end: 6882 },
            },
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'orderDirection',
                loc: { start: 6884, end: 6898 },
              },
              type: {
                kind: 'NamedType',
                name: {
                  kind: 'Name',
                  value: 'OrderDirection',
                  loc: { start: 6900, end: 6914 },
                },
                loc: { start: 6900, end: 6914 },
              },
              directives: [],
              loc: { start: 6884, end: 6914 },
            },
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'first', loc: { start: 6916, end: 6921 } },
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'Int', loc: { start: 6923, end: 6926 } },
                loc: { start: 6923, end: 6926 },
              },
              directives: [],
              loc: { start: 6916, end: 6926 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'Action', loc: { start: 6930, end: 6936 } },
                loc: { start: 6930, end: 6936 },
              },
              loc: { start: 6929, end: 6937 },
            },
            loc: { start: 6929, end: 6938 },
          },
          directives: [],
          loc: { start: 6831, end: 6938 },
        },
      ],
      loc: { start: 5966, end: 6940 },
    },
    {
      kind: 'ObjectTypeDefinition',
      name: { kind: 'Name', value: 'Mutation', loc: { start: 6947, end: 6955 } },
      interfaces: [],
      directives: [],
      fields: [
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'setIndexingRule',
            loc: { start: 6960, end: 6975 },
          },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'rule', loc: { start: 6976, end: 6980 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'IndexingRuleInput',
                    loc: { start: 6982, end: 6999 },
                  },
                  loc: { start: 6982, end: 6999 },
                },
                loc: { start: 6982, end: 7000 },
              },
              directives: [],
              loc: { start: 6976, end: 7000 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'IndexingRule',
                loc: { start: 7003, end: 7015 },
              },
              loc: { start: 7003, end: 7015 },
            },
            loc: { start: 7003, end: 7016 },
          },
          directives: [],
          loc: { start: 6960, end: 7016 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'deleteIndexingRule',
            loc: { start: 7019, end: 7037 },
          },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'identifier',
                loc: { start: 7038, end: 7048 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'IndexingRuleIdentifier',
                    loc: { start: 7050, end: 7072 },
                  },
                  loc: { start: 7050, end: 7072 },
                },
                loc: { start: 7050, end: 7073 },
              },
              directives: [],
              loc: { start: 7038, end: 7073 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Boolean', loc: { start: 7076, end: 7083 } },
              loc: { start: 7076, end: 7083 },
            },
            loc: { start: 7076, end: 7084 },
          },
          directives: [],
          loc: { start: 7019, end: 7084 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'deleteIndexingRules',
            loc: { start: 7087, end: 7106 },
          },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'identifiers',
                loc: { start: 7107, end: 7118 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'ListType',
                  type: {
                    kind: 'NonNullType',
                    type: {
                      kind: 'NamedType',
                      name: {
                        kind: 'Name',
                        value: 'IndexingRuleIdentifier',
                        loc: { start: 7121, end: 7143 },
                      },
                      loc: { start: 7121, end: 7143 },
                    },
                    loc: { start: 7121, end: 7144 },
                  },
                  loc: { start: 7120, end: 7145 },
                },
                loc: { start: 7120, end: 7146 },
              },
              directives: [],
              loc: { start: 7107, end: 7146 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Boolean', loc: { start: 7149, end: 7156 } },
              loc: { start: 7149, end: 7156 },
            },
            loc: { start: 7149, end: 7157 },
          },
          directives: [],
          loc: { start: 7087, end: 7157 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'setCostModel', loc: { start: 7160, end: 7172 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'costModel', loc: { start: 7173, end: 7182 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'CostModelInput',
                    loc: { start: 7184, end: 7198 },
                  },
                  loc: { start: 7184, end: 7198 },
                },
                loc: { start: 7184, end: 7199 },
              },
              directives: [],
              loc: { start: 7173, end: 7199 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'CostModel', loc: { start: 7202, end: 7211 } },
              loc: { start: 7202, end: 7211 },
            },
            loc: { start: 7202, end: 7212 },
          },
          directives: [],
          loc: { start: 7160, end: 7212 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'deleteCostModels',
            loc: { start: 7215, end: 7231 },
          },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'deployments',
                loc: { start: 7232, end: 7243 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'ListType',
                  type: {
                    kind: 'NonNullType',
                    type: {
                      kind: 'NamedType',
                      name: {
                        kind: 'Name',
                        value: 'String',
                        loc: { start: 7246, end: 7252 },
                      },
                      loc: { start: 7246, end: 7252 },
                    },
                    loc: { start: 7246, end: 7253 },
                  },
                  loc: { start: 7245, end: 7254 },
                },
                loc: { start: 7245, end: 7255 },
              },
              directives: [],
              loc: { start: 7232, end: 7255 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 7258, end: 7261 } },
              loc: { start: 7258, end: 7261 },
            },
            loc: { start: 7258, end: 7262 },
          },
          directives: [],
          loc: { start: 7215, end: 7262 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'storeDisputes', loc: { start: 7265, end: 7278 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'disputes', loc: { start: 7279, end: 7287 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'ListType',
                  type: {
                    kind: 'NonNullType',
                    type: {
                      kind: 'NamedType',
                      name: {
                        kind: 'Name',
                        value: 'POIDisputeInput',
                        loc: { start: 7290, end: 7305 },
                      },
                      loc: { start: 7290, end: 7305 },
                    },
                    loc: { start: 7290, end: 7306 },
                  },
                  loc: { start: 7289, end: 7307 },
                },
                loc: { start: 7289, end: 7308 },
              },
              directives: [],
              loc: { start: 7279, end: 7308 },
            },
          ],
          type: {
            kind: 'ListType',
            type: {
              kind: 'NonNullType',
              type: {
                kind: 'NamedType',
                name: {
                  kind: 'Name',
                  value: 'POIDispute',
                  loc: { start: 7312, end: 7322 },
                },
                loc: { start: 7312, end: 7322 },
              },
              loc: { start: 7312, end: 7323 },
            },
            loc: { start: 7311, end: 7324 },
          },
          directives: [],
          loc: { start: 7265, end: 7324 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'deleteDisputes',
            loc: { start: 7327, end: 7341 },
          },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'identifiers',
                loc: { start: 7342, end: 7353 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'ListType',
                  type: {
                    kind: 'NonNullType',
                    type: {
                      kind: 'NamedType',
                      name: {
                        kind: 'Name',
                        value: 'POIDisputeIdentifier',
                        loc: { start: 7356, end: 7376 },
                      },
                      loc: { start: 7356, end: 7376 },
                    },
                    loc: { start: 7356, end: 7377 },
                  },
                  loc: { start: 7355, end: 7378 },
                },
                loc: { start: 7355, end: 7379 },
              },
              directives: [],
              loc: { start: 7342, end: 7379 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 7382, end: 7385 } },
              loc: { start: 7382, end: 7385 },
            },
            loc: { start: 7382, end: 7386 },
          },
          directives: [],
          loc: { start: 7327, end: 7386 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'createAllocation',
            loc: { start: 7389, end: 7405 },
          },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'deployment',
                loc: { start: 7406, end: 7416 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'String',
                    loc: { start: 7418, end: 7424 },
                  },
                  loc: { start: 7418, end: 7424 },
                },
                loc: { start: 7418, end: 7425 },
              },
              directives: [],
              loc: { start: 7406, end: 7425 },
            },
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'amount', loc: { start: 7427, end: 7433 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'String',
                    loc: { start: 7435, end: 7441 },
                  },
                  loc: { start: 7435, end: 7441 },
                },
                loc: { start: 7435, end: 7442 },
              },
              directives: [],
              loc: { start: 7427, end: 7442 },
            },
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'indexNode', loc: { start: 7444, end: 7453 } },
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'String', loc: { start: 7455, end: 7461 } },
                loc: { start: 7455, end: 7461 },
              },
              directives: [],
              loc: { start: 7444, end: 7461 },
            },
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'protocolNetwork',
                loc: { start: 7463, end: 7478 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'String',
                    loc: { start: 7480, end: 7486 },
                  },
                  loc: { start: 7480, end: 7486 },
                },
                loc: { start: 7480, end: 7487 },
              },
              directives: [],
              loc: { start: 7463, end: 7487 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'CreateAllocationResult',
                loc: { start: 7490, end: 7512 },
              },
              loc: { start: 7490, end: 7512 },
            },
            loc: { start: 7490, end: 7513 },
          },
          directives: [],
          loc: { start: 7389, end: 7513 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'closeAllocation',
            loc: { start: 7516, end: 7531 },
          },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'allocation',
                loc: { start: 7532, end: 7542 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'String',
                    loc: { start: 7544, end: 7550 },
                  },
                  loc: { start: 7544, end: 7550 },
                },
                loc: { start: 7544, end: 7551 },
              },
              directives: [],
              loc: { start: 7532, end: 7551 },
            },
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'poi', loc: { start: 7553, end: 7556 } },
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'String', loc: { start: 7558, end: 7564 } },
                loc: { start: 7558, end: 7564 },
              },
              directives: [],
              loc: { start: 7553, end: 7564 },
            },
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'force', loc: { start: 7566, end: 7571 } },
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'Boolean', loc: { start: 7573, end: 7580 } },
                loc: { start: 7573, end: 7580 },
              },
              directives: [],
              loc: { start: 7566, end: 7580 },
            },
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'protocolNetwork',
                loc: { start: 7582, end: 7597 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'String',
                    loc: { start: 7599, end: 7605 },
                  },
                  loc: { start: 7599, end: 7605 },
                },
                loc: { start: 7599, end: 7606 },
              },
              directives: [],
              loc: { start: 7582, end: 7606 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'CloseAllocationResult',
                loc: { start: 7609, end: 7630 },
              },
              loc: { start: 7609, end: 7630 },
            },
            loc: { start: 7609, end: 7631 },
          },
          directives: [],
          loc: { start: 7516, end: 7631 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'reallocateAllocation',
            loc: { start: 7634, end: 7654 },
          },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'allocation',
                loc: { start: 7655, end: 7665 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'String',
                    loc: { start: 7667, end: 7673 },
                  },
                  loc: { start: 7667, end: 7673 },
                },
                loc: { start: 7667, end: 7674 },
              },
              directives: [],
              loc: { start: 7655, end: 7674 },
            },
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'poi', loc: { start: 7676, end: 7679 } },
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'String', loc: { start: 7681, end: 7687 } },
                loc: { start: 7681, end: 7687 },
              },
              directives: [],
              loc: { start: 7676, end: 7687 },
            },
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'amount', loc: { start: 7689, end: 7695 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'String',
                    loc: { start: 7697, end: 7703 },
                  },
                  loc: { start: 7697, end: 7703 },
                },
                loc: { start: 7697, end: 7704 },
              },
              directives: [],
              loc: { start: 7689, end: 7704 },
            },
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'force', loc: { start: 7706, end: 7711 } },
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'Boolean', loc: { start: 7713, end: 7720 } },
                loc: { start: 7713, end: 7720 },
              },
              directives: [],
              loc: { start: 7706, end: 7720 },
            },
            {
              kind: 'InputValueDefinition',
              name: {
                kind: 'Name',
                value: 'protocolNetwork',
                loc: { start: 7722, end: 7737 },
              },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'String',
                    loc: { start: 7739, end: 7745 },
                  },
                  loc: { start: 7739, end: 7745 },
                },
                loc: { start: 7739, end: 7746 },
              },
              directives: [],
              loc: { start: 7722, end: 7746 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: {
                kind: 'Name',
                value: 'ReallocateAllocationResult',
                loc: { start: 7749, end: 7775 },
              },
              loc: { start: 7749, end: 7775 },
            },
            loc: { start: 7749, end: 7776 },
          },
          directives: [],
          loc: { start: 7634, end: 7776 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'updateAction', loc: { start: 7779, end: 7791 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'action', loc: { start: 7792, end: 7798 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'ActionInput',
                    loc: { start: 7800, end: 7811 },
                  },
                  loc: { start: 7800, end: 7811 },
                },
                loc: { start: 7800, end: 7812 },
              },
              directives: [],
              loc: { start: 7792, end: 7812 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Action', loc: { start: 7815, end: 7821 } },
              loc: { start: 7815, end: 7821 },
            },
            loc: { start: 7815, end: 7822 },
          },
          directives: [],
          loc: { start: 7779, end: 7822 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'updateActions', loc: { start: 7825, end: 7838 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'filter', loc: { start: 7839, end: 7845 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'ActionFilter',
                    loc: { start: 7847, end: 7859 },
                  },
                  loc: { start: 7847, end: 7859 },
                },
                loc: { start: 7847, end: 7860 },
              },
              directives: [],
              loc: { start: 7839, end: 7860 },
            },
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'action', loc: { start: 7862, end: 7868 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'ActionUpdateInput',
                    loc: { start: 7870, end: 7887 },
                  },
                  loc: { start: 7870, end: 7887 },
                },
                loc: { start: 7870, end: 7888 },
              },
              directives: [],
              loc: { start: 7862, end: 7888 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'Action', loc: { start: 7892, end: 7898 } },
                loc: { start: 7892, end: 7898 },
              },
              loc: { start: 7891, end: 7899 },
            },
            loc: { start: 7891, end: 7900 },
          },
          directives: [],
          loc: { start: 7825, end: 7900 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'queueActions', loc: { start: 7903, end: 7915 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'actions', loc: { start: 7916, end: 7923 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'ListType',
                  type: {
                    kind: 'NonNullType',
                    type: {
                      kind: 'NamedType',
                      name: {
                        kind: 'Name',
                        value: 'ActionInput',
                        loc: { start: 7926, end: 7937 },
                      },
                      loc: { start: 7926, end: 7937 },
                    },
                    loc: { start: 7926, end: 7938 },
                  },
                  loc: { start: 7925, end: 7939 },
                },
                loc: { start: 7925, end: 7940 },
              },
              directives: [],
              loc: { start: 7916, end: 7940 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'Action', loc: { start: 7944, end: 7950 } },
                loc: { start: 7944, end: 7950 },
              },
              loc: { start: 7943, end: 7951 },
            },
            loc: { start: 7943, end: 7952 },
          },
          directives: [],
          loc: { start: 7903, end: 7952 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'cancelActions', loc: { start: 7955, end: 7968 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'actionIDs', loc: { start: 7969, end: 7978 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'ListType',
                  type: {
                    kind: 'NonNullType',
                    type: {
                      kind: 'NamedType',
                      name: {
                        kind: 'Name',
                        value: 'String',
                        loc: { start: 7981, end: 7987 },
                      },
                      loc: { start: 7981, end: 7987 },
                    },
                    loc: { start: 7981, end: 7988 },
                  },
                  loc: { start: 7980, end: 7989 },
                },
                loc: { start: 7980, end: 7990 },
              },
              directives: [],
              loc: { start: 7969, end: 7990 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'Action', loc: { start: 7994, end: 8000 } },
                loc: { start: 7994, end: 8000 },
              },
              loc: { start: 7993, end: 8001 },
            },
            loc: { start: 7993, end: 8002 },
          },
          directives: [],
          loc: { start: 7955, end: 8002 },
        },
        {
          kind: 'FieldDefinition',
          name: { kind: 'Name', value: 'deleteActions', loc: { start: 8005, end: 8018 } },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'actionIDs', loc: { start: 8019, end: 8028 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'ListType',
                  type: {
                    kind: 'NonNullType',
                    type: {
                      kind: 'NamedType',
                      name: {
                        kind: 'Name',
                        value: 'String',
                        loc: { start: 8031, end: 8037 },
                      },
                      loc: { start: 8031, end: 8037 },
                    },
                    loc: { start: 8031, end: 8038 },
                  },
                  loc: { start: 8030, end: 8039 },
                },
                loc: { start: 8030, end: 8040 },
              },
              directives: [],
              loc: { start: 8019, end: 8040 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'Int', loc: { start: 8043, end: 8046 } },
              loc: { start: 8043, end: 8046 },
            },
            loc: { start: 8043, end: 8047 },
          },
          directives: [],
          loc: { start: 8005, end: 8047 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'approveActions',
            loc: { start: 8050, end: 8064 },
          },
          arguments: [
            {
              kind: 'InputValueDefinition',
              name: { kind: 'Name', value: 'actionIDs', loc: { start: 8065, end: 8074 } },
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'ListType',
                  type: {
                    kind: 'NonNullType',
                    type: {
                      kind: 'NamedType',
                      name: {
                        kind: 'Name',
                        value: 'String',
                        loc: { start: 8077, end: 8083 },
                      },
                      loc: { start: 8077, end: 8083 },
                    },
                    loc: { start: 8077, end: 8084 },
                  },
                  loc: { start: 8076, end: 8085 },
                },
                loc: { start: 8076, end: 8086 },
              },
              directives: [],
              loc: { start: 8065, end: 8086 },
            },
          ],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NamedType',
                name: { kind: 'Name', value: 'Action', loc: { start: 8090, end: 8096 } },
                loc: { start: 8090, end: 8096 },
              },
              loc: { start: 8089, end: 8097 },
            },
            loc: { start: 8089, end: 8098 },
          },
          directives: [],
          loc: { start: 8050, end: 8098 },
        },
        {
          kind: 'FieldDefinition',
          name: {
            kind: 'Name',
            value: 'executeApprovedActions',
            loc: { start: 8101, end: 8123 },
          },
          arguments: [],
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'ListType',
              type: {
                kind: 'NonNullType',
                type: {
                  kind: 'NamedType',
                  name: {
                    kind: 'Name',
                    value: 'ActionResult',
                    loc: { start: 8126, end: 8138 },
                  },
                  loc: { start: 8126, end: 8138 },
                },
                loc: { start: 8126, end: 8139 },
              },
              loc: { start: 8125, end: 8140 },
            },
            loc: { start: 8125, end: 8141 },
          },
          directives: [],
          loc: { start: 8101, end: 8141 },
        },
      ],
      loc: { start: 6942, end: 8143 },
    },
  ],
  loc: { start: 0, end: 8144 },
} as unknown as DocumentNode
