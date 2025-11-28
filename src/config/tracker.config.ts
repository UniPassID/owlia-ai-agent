import { registerAs } from '@nestjs/config';
import { getEnvOrThrow } from './utils';

export default registerAs('tracker', () => ({
  url: getEnvOrThrow('TRACKER_URL'),
}));
