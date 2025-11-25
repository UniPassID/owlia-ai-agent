import { INestApplication, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AllExceptionsFilter } from './common/filters/all-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

export function initApp(app: INestApplication<any>): INestApplication<any> {
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
  });
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle('Owlia AI Agent')
    .setDescription('Owlia AI Agent API description')
    .setVersion('1.0')
    .addTag('Owlia AI Agent')
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, documentFactory);
  return app;
}
