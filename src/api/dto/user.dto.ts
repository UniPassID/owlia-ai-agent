import { IsString, IsNotEmpty } from 'class-validator';

export class RegisterUserDto {
  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  safeOwner: string;

  @IsString()
  @IsNotEmpty()
  activationTxHash: string;

  @IsString()
  @IsNotEmpty()
  chainId: string;
}
