import { ApiProperty } from '@nestjs/swagger';
import { NetworkDto } from './common.dto';

export class RegisterAccountDto {
  @ApiProperty({
    description: 'The network of the account',
    enum: NetworkDto,
    default: NetworkDto.Bsc,
  })
  network: NetworkDto;

  @ApiProperty({
    description: 'The wallet address of the account',
    example: '0x1234567890abcdef',
  })
  walletAddress: string;

  @ApiProperty({
    description: 'The registered signature of the account',
    example: '0x1234567890abcdef',
  })
  signature: string;
}
