import { registerAs } from '@nestjs/config';
import { getEnvOrThrow } from './utils';

export default registerAs('private', () => ({
  privateKey: getEnvOrThrow('PRIVATE_KEY'),
}));
