export const UNISWAP_V3_OWLIA_VALIDATOR_ABI = [
  {
    type: 'constructor',
    inputs: [
      {
        name: '_nonfungiblePositionManager',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'NONFUNGIBLE_POSITION_MANAGER',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract INonfungiblePositionManager',
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
    name: 'getPoolConfig',
    inputs: [
      { name: 'user', type: 'address', internalType: 'address' },
      { name: 'token0', type: 'address', internalType: 'address' },
      { name: 'token1', type: 'address', internalType: 'address' },
      { name: 'fee', type: 'uint24', internalType: 'uint24' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct UniswapV3OwliaValidator.PoolConfig',
        components: [
          {
            name: 'minTickLimit',
            type: 'int32',
            internalType: 'int32',
          },
          { name: 'maxTickLimit', type: 'int32', internalType: 'int32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPoolId',
    inputs: [
      { name: 'token0', type: 'address', internalType: 'address' },
      { name: 'token1', type: 'address', internalType: 'address' },
      { name: 'fee', type: 'uint24', internalType: 'uint24' },
    ],
    outputs: [{ name: 'poolId', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'nonfungiblePositionManager',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setPoolConfig',
    inputs: [
      { name: 'token0', type: 'address', internalType: 'address' },
      { name: 'token1', type: 'address', internalType: 'address' },
      { name: 'fee', type: 'uint24', internalType: 'uint24' },
      { name: 'minTickLimit', type: 'int32', internalType: 'int32' },
      { name: 'maxTickLimit', type: 'int32', internalType: 'int32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'error',
    name: 'InvalidUniswapV3LiquidityTokenOwner',
    inputs: [],
  },
  { type: 'error', name: 'InvalidUniswapV3Operation', inputs: [] },
  { type: 'error', name: 'InvalidUniswapV3Recipient', inputs: [] },
  { type: 'error', name: 'InvalidUniswapV3TickRange', inputs: [] },
  { type: 'error', name: 'InvalidUniswapV3TokenApproval', inputs: [] },
  { type: 'error', name: 'InvalidUniswapV3TxTo', inputs: [] },
  { type: 'error', name: 'InvalidUniswapV3TxValue', inputs: [] },
] as const;
