import { registerAs } from '@nestjs/config';

export default registerAs('protocol', () => {
  return {
    lendingProtocols: process.env.LENDING_PROTOCOLS?.split(',') || [
      'aave',
      'venus',
    ],
  };
});
