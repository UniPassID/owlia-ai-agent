export const GUARD_ABI = [
  {
    type: "constructor",
    inputs: [
      {
        name: "config",
        type: "tuple",
        internalType: "struct OwliaGuard.OwliaGuardConfig",
        components: [
          {
            name: "owliaOperator",
            type: "address",
            internalType: "address",
          },
          {
            name: "multisend",
            type: "address",
            internalType: "address",
          },
          {
            name: "uniswapV3NonFungiblePM",
            type: "address",
            internalType: "contract INonfungiblePositionManager",
          },
          {
            name: "aerodromeCLNonFungiblePM",
            type: "address",
            internalType: "contract IAerodromeCLNonfungiblePositionManager",
          },
          {
            name: "aaveV3Pool",
            type: "address",
            internalType: "contract IAaveV3Pool",
          },
          {
            name: "eulerV2EVC",
            type: "address",
            internalType: "contract IEthereumVaultConnector",
          },
          {
            name: "venusV4Comptroller",
            type: "address",
            internalType: "contract IVenusComptroller",
          },
          {
            name: "kyberMetaAggregationRouterV2",
            type: "address",
            internalType: "contract IKyberMetaAggregationRouterV2",
          },
          {
            name: "allowedTokens",
            type: "address[]",
            internalType: "address[]",
          },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "AAVE_V3_POOL",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IAaveV3Pool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "AERODROME_CL_NON_FUNGIBLE_PM",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IAerodromeCLNonfungiblePositionManager",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "EULER_V2_EVC",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IEthereumVaultConnector",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "KYBER_META_AGGREGATION_ROUTER_V2",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IKyberMetaAggregationRouterV2",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MULTISEND",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "OWLIA_OPERATOR",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "UNISWAP_V3_NON_FUNGIBLE_PM",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract INonfungiblePositionManager",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "VENUS_V4_COMPTROLLER",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IVenusComptroller",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "checkAfterExecution",
    inputs: [
      { name: "txHash", type: "bytes32", internalType: "bytes32" },
      { name: "success", type: "bool", internalType: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "checkTransaction",
    inputs: [
      { name: "to", type: "address", internalType: "address" },
      { name: "value", type: "uint256", internalType: "uint256" },
      { name: "data", type: "bytes", internalType: "bytes" },
      {
        name: "operation",
        type: "uint8",
        internalType: "enum Enum.Operation",
      },
      { name: "safeTxGas", type: "uint256", internalType: "uint256" },
      { name: "baseGas", type: "uint256", internalType: "uint256" },
      { name: "gasPrice", type: "uint256", internalType: "uint256" },
      { name: "gasToken", type: "address", internalType: "address" },
      {
        name: "refundReceiver",
        type: "address",
        internalType: "address payable",
      },
      { name: "signatures", type: "bytes", internalType: "bytes" },
      { name: "", type: "address", internalType: "address" },
    ],
    outputs: [],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAerodromeCLPoolConfig",
    inputs: [
      { name: "wallet", type: "address", internalType: "address" },
      { name: "token0", type: "address", internalType: "address" },
      { name: "token1", type: "address", internalType: "address" },
      { name: "tickSpacing", type: "int24", internalType: "int24" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct OwliaGuard.PoolConfig",
        components: [
          {
            name: "minTickLimit",
            type: "int32",
            internalType: "int32",
          },
          { name: "maxTickLimit", type: "int32", internalType: "int32" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getUniswapV3PoolConfig",
    inputs: [
      { name: "wallet", type: "address", internalType: "address" },
      { name: "token0", type: "address", internalType: "address" },
      { name: "token1", type: "address", internalType: "address" },
      { name: "fee", type: "uint24", internalType: "uint24" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct OwliaGuard.PoolConfig",
        components: [
          {
            name: "minTickLimit",
            type: "int32",
            internalType: "int32",
          },
          { name: "maxTickLimit", type: "int32", internalType: "int32" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isTokenAllowedForLending",
    inputs: [{ name: "token", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setAerodromeCLPoolConfig",
    inputs: [
      { name: "token0", type: "address", internalType: "address" },
      { name: "token1", type: "address", internalType: "address" },
      { name: "tickSpacing", type: "int24", internalType: "int24" },
      { name: "minTickLimit", type: "int32", internalType: "int32" },
      { name: "maxTickLimit", type: "int32", internalType: "int32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setUniswapV3PoolConfig",
    inputs: [
      { name: "token0", type: "address", internalType: "address" },
      { name: "token1", type: "address", internalType: "address" },
      { name: "fee", type: "uint24", internalType: "uint24" },
      { name: "minTickLimit", type: "int32", internalType: "int32" },
      { name: "maxTickLimit", type: "int32", internalType: "int32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "supportsInterface",
    inputs: [{ name: "interfaceId", type: "bytes4", internalType: "bytes4" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  { type: "error", name: "InvalidEulerV2LendingOperation", inputs: [] },
  { type: "error", name: "InvalidMultiSend", inputs: [] },
  { type: "error", name: "InvalidNFTOwner", inputs: [] },
  { type: "error", name: "InvalidOwliaMultisendTxData", inputs: [] },
  {
    type: "error",
    name: "InvalidOwliaMultisendTxOperation",
    inputs: [],
  },
  { type: "error", name: "InvalidOwliaMultisendTxTo", inputs: [] },
  { type: "error", name: "InvalidOwliaMultisendTxValue", inputs: [] },
  { type: "error", name: "InvalidOwliaOperation", inputs: [] },
  { type: "error", name: "InvalidOwliaRecipient", inputs: [] },
  { type: "error", name: "InvalidOwliaSignature", inputs: [] },
  { type: "error", name: "InvalidOwliaTxData", inputs: [] },
  { type: "error", name: "InvalidPoolTickRange", inputs: [] },
  { type: "error", name: "InvalidTokenApproval", inputs: [] },
  { type: "error", name: "InvalidVenusV4Operation", inputs: [] },
  {
    type: "error",
    name: "TokenNotSupported",
    inputs: [{ name: "token", type: "address", internalType: "address" }],
  },
];
