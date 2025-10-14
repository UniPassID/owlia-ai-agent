import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Set global prefix
  app.setGlobalPrefix('api/v1');

  // Enable CORS
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  });

  // Get config
  const configService = app.get(ConfigService);
  const apiPrefix = configService.get('API_PREFIX') || '';

  // Setup Swagger/OpenAPI
  const configBuilder = new DocumentBuilder()
    .setTitle('DeFi AI Agent API')
    .setDescription('API for managing DeFi portfolio rebalancing with AI agent')
    .setVersion('1.0')
    .addTag('user', 'User registration and management')
    .addTag('rebalance', 'Portfolio rebalancing and policy management');

  // Add server with configurable prefix
  if (apiPrefix) {
    configBuilder.addServer(apiPrefix, 'API Server with prefix');
  } else {
    configBuilder.addServer('/', 'Direct access');
  }

  const config = configBuilder.build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get('PORT') || 3000;

  await app.listen(port);
  console.log(`🚀 DeFi AI Agent Backend running on http://localhost:${port}`);
  console.log(`📚 API Documentation available at http://localhost:${port}/api/docs`);
  console.log(`📊 Environment: ${configService.get('NODE_ENV')}`);
}

bootstrap();
