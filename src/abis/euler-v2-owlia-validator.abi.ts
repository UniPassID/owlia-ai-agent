export const EULER_V2_OWLIA_VALIDATOR_ABI = [
  {
    type: 'constructor',
    inputs: [{ name: '_eulerV2EVC', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'EULER_V2_EVC',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract IEthereumVaultConnector',
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
    name: 'eulerV2EVC',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getUserAllowedVault',
    inputs: [
      { name: 'user', type: 'address', internalType: 'address' },
      { name: 'vault', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setAllowedVault',
    inputs: [
      { name: 'vault', type: 'address', internalType: 'address' },
      { name: 'allowed', type: 'bool', internalType: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'error',
    name: 'EulerV2VaultNotSupported',
    inputs: [{ name: 'vault', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'InvalidEulerV2BatchItemCount', inputs: [] },
  { type: 'error', name: 'InvalidEulerV2EVCTo', inputs: [] },
  { type: 'error', name: 'InvalidEulerV2EVCValue', inputs: [] },
  { type: 'error', name: 'InvalidEulerV2Operation', inputs: [] },
  { type: 'error', name: 'InvalidEulerV2Recipient', inputs: [] },
  { type: 'error', name: 'InvalidEulerV2TokenApproval', inputs: [] },
] as const;
