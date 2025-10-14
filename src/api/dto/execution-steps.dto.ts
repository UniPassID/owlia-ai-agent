import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExecutionStepMetadataDto {
  @ApiPropertyOptional({
    description: 'Additional context or reason for this step',
    example: '- Aerodrome oUSDT/USDC LP: **20% APY** (+11.35%)\n- Aave USDC supply: **16.2% APY** (+7.55%)',
  })
  reason?: string;

  @ApiPropertyOptional({
    description: 'Transaction hash (if applicable)',
    example: '0x195e689fd0c42dcbcb9824095daaf261e83729d3bd41c28eea850982b44058d0',
  })
  txHash?: string;

}

export class ExecutionStepDto {
  @ApiProperty({
    description: 'Step ID',
    example: '1',
  })
  id: string;

  @ApiProperty({
    description: 'Step description',
    example: 'Current: $150.21 at 8.65% APY',
  })
  content: string;

  @ApiProperty({
    description: 'Step status',
    enum: ['success', 'pending', 'error'],
    example: 'success',
  })
  status: 'success' | 'pending' | 'error';

  @ApiPropertyOptional({
    description: 'Additional metadata for this step',
    type: ExecutionStepMetadataDto,
  })
  metadata?: ExecutionStepMetadataDto;
}
