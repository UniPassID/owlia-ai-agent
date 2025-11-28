import { registerAs } from '@nestjs/config';

export default registerAs('blockchains', () => {
  const bsc_rpc_urls = process.env.BSC_RPC_URLS?.split(',');
  if (!bsc_rpc_urls) {
    throw new Error('BSC_RPC_URLS is not set');
  }
  const base_rpc_urls = process.env.BASE_RPC_URLS?.split(',');
  if (!base_rpc_urls) {
    throw new Error('BASE_RPC_URLS is not set');
  }
  return {
    bsc: {
      rpcUrls: bsc_rpc_urls,
    },
    base: {
      rpcUrls: base_rpc_urls,
    },
  };
});
