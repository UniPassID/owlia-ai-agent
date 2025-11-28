import { ApiProperty } from '@nestjs/swagger';
import { NetworkDto } from '../../common/dto/network.dto';
import { Address } from '../../common/decorators/address.decorator';

export class UserPortfolioRequestDto {
  @ApiProperty({
    description: 'The network of the user portfolio',
    enum: NetworkDto,
  })
  network: NetworkDto;

  @ApiProperty({
    description: 'The address of the user portfolio',
    example: '0x1234567890abcdef',
  })
  @Address()
  address: string;
}
