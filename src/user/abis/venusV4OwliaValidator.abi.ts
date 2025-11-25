export const VENUS_V4_OWLIA_VALIDATOR_ABI = [
  {
    type: 'constructor',
    inputs: [
      {
        name: '_venusV4Comptroller',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'VENUS_V4_COMPTROLLER',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract IVenusComptroller',
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
    type: 'function',
    name: 'venusV4Comptroller',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  { type: 'error', name: 'InvalidVenusV4Operation', inputs: [] },
  { type: 'error', name: 'InvalidVenusV4TokenApproval', inputs: [] },
  { type: 'error', name: 'InvalidVenusV4TxValue', inputs: [] },
  {
    type: 'error',
    name: 'VenusV4VaultNotSupported',
    inputs: [{ name: 'vault', type: 'address', internalType: 'address' }],
  },
] as const;
