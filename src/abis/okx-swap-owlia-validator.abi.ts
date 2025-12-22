export const OKX_SWAP_OWLIA_VALIDATOR_ABI = [
  {
    type: 'constructor',
    inputs: [
      {
        name: '_okxDexRouter',
        type: 'address',
        internalType: 'address',
      },
      {
        name: '_okxDexTokenApproval',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'OKX_DEX_ROUTER',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract IOkxDexRouter',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'OKX_DEX_TOKEN_APPROVAL',
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
    name: 'okxDexRouter',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'okxDexTokenApproval',
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
  { type: 'error', name: 'InvalidOkxDexOperation', inputs: [] },
  { type: 'error', name: 'InvalidOkxDexRecipient', inputs: [] },
  { type: 'error', name: 'InvalidOkxDexTokenApproval', inputs: [] },
  { type: 'error', name: 'InvalidOkxDexTxTo', inputs: [] },
  { type: 'error', name: 'InvalidOkxDexTxValue', inputs: [] },
  {
    type: 'error',
    name: 'OkxDexTokenNotSupported',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
] as const;
