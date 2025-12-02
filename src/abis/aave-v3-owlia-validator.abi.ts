export const AAVE_V3_OWLIA_VALIDATOR_ABI = [
  {
    type: 'constructor',
    inputs: [{ name: '_aaveV3Pool', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'AAVE_V3_POOL',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract IAaveV3Pool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'aaveV3Pool',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
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
    name: 'getUserAllowedAsset',
    inputs: [
      { name: 'user', type: 'address', internalType: 'address' },
      { name: 'asset', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setAllowedAsset',
    inputs: [
      { name: 'asset', type: 'address', internalType: 'address' },
      { name: 'allowed', type: 'bool', internalType: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'error',
    name: 'AaveV3AssetNotSupported',
    inputs: [{ name: 'asset', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'InvalidAaveV3Operation', inputs: [] },
  { type: 'error', name: 'InvalidAaveV3Recipient', inputs: [] },
  { type: 'error', name: 'InvalidAaveV3TokenApproval', inputs: [] },
  { type: 'error', name: 'InvalidAaveV3TxTo', inputs: [] },
  { type: 'error', name: 'InvalidAaveV3TxValue', inputs: [] },
] as const;
