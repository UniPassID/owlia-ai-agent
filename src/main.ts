import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { initApp } from './app.init';

async function bootstrap() {
  let app = await NestFactory.create(AppModule);
  app = initApp(app);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
