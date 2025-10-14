import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterUserDto {
  @ApiProperty({
    description: 'User wallet address',
    example: '0x1234567890123456789012345678901234567890',
  })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({
    description: 'Safe owner address',
    example: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  })
  @IsString()
  @IsNotEmpty()
  safeOwner: string;

  @ApiProperty({
    description: 'Activation transaction hash',
    example: '0x9876543210987654321098765432109876543210987654321098765432109876',
  })
  @IsString()
  @IsNotEmpty()
  activationTxHash: string;

  @ApiProperty({
    description: 'Blockchain chain ID',
    example: 'ethereum',
  })
  @IsString()
  @IsNotEmpty()
  chainId: string;
}
