import { ApiProperty } from '@nestjs/swagger';
import { Address } from '../../../common/decorators/address.decorator';
import { NetworkDto } from '../../../common/dto/network.dto';

export class GetTransactionsDto {
  @Address()
  @ApiProperty({
    description: 'The address of the user',
    example: '0x1234567890abcdef',
  })
  address: string;

  @ApiProperty({
    description: 'The network of the user',
    example: 'base',
  })
  network: NetworkDto;

  @ApiProperty({
    description: 'The page number',
    example: 1,
  })
  page?: number;

  @ApiProperty({
    description: 'The page size',
    example: 10,
  })
  pageSize?: number;
}
