import { registerAs } from '@nestjs/config';
import { getEnvOrThrow } from './utils';

export default registerAs('blockchains', () => ({
  bsc: {
    rpcUrl: getEnvOrThrow('BSC_RPC_URL'),
  },
  base: {
    rpcUrl: getEnvOrThrow('BASE_RPC_URL'),
  },
}));
