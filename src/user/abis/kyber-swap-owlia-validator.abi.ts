export const KYBER_SWAP_OWLIA_VALIDATOR_ABI = [
  {
    type: 'constructor',
    inputs: [
      {
        name: '_kyberMetaAggregationRouterV2',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'KYBER_META_AGGREGATION_ROUTER_V2',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract IKyberMetaAggregationRouterV2',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'checkTransaction',
    inputs: [
      { name: 'sender', type: 'address', internalType: 'address' },
      { name: 'to', type: 'address', internalType: 'address' },
      { name: 'value', type: 'uint256', internalType: 'uint256' },
      { name: 'data', type: 'bytes', internalType: 'bytes' },
      { name: 'approvals', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getUserAllowedToken',
    inputs: [
      { name: 'user', type: 'address', internalType: 'address' },
      { name: 'token', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'kyberMetaAggregationRouterV2',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setAllowedToken',
    inputs: [
      { name: 'token', type: 'address', internalType: 'address' },
      { name: 'allowed', type: 'bool', internalType: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  { type: 'error', name: 'InvalidKyberSwapOperation', inputs: [] },
  { type: 'error', name: 'InvalidKyberSwapRecipient', inputs: [] },
  { type: 'error', name: 'InvalidKyberSwapTokenApproval', inputs: [] },
  { type: 'error', name: 'InvalidKyberSwapTxTo', inputs: [] },
  { type: 'error', name: 'InvalidKyberSwapTxValue', inputs: [] },
  {
    type: 'error',
    name: 'KyberSwapTokenNotSupported',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
] as const;
