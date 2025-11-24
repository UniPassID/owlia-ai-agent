import { registerAs } from '@nestjs/config';
import { getEnvOrThrow } from './utils';

export default registerAs('database', () => ({
  host: getEnvOrThrow('DB_HOST'),
  port: parseInt(getEnvOrThrow('DB_PORT'), 10),
  username: getEnvOrThrow('DB_USERNAME'),
  password: getEnvOrThrow('DB_PASSWORD'),
  database: getEnvOrThrow('DB_DATABASE'),
}));
