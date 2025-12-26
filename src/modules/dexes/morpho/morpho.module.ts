import { Module } from '@nestjs/common';
import { MorphoService } from './morpho.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [MorphoService],
  exports: [MorphoService],
})
export class MorphoModule {}
