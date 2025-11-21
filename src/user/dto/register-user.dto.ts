import { ApiProperty } from '@nestjs/swagger';
import { NetworkDto } from './common.dto';

export class RegisterUserDto {
  @ApiProperty({
    description: 'The network of the user',
    enum: NetworkDto,
    default: NetworkDto.Bsc,
  })
  network: NetworkDto;

  @ApiProperty({
    description: 'The owner of the user',
    example: '0x1234567890abcdef',
  })
  owner: string;

  @ApiProperty({
    description: 'The registered signature of the user',
    example: '0x1234567890abcdef',
  })
  signature: string;
}
