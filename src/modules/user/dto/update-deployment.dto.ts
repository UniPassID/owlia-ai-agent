import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Address } from '../../../common/decorators/address.decorator';
import { DeploymentDto } from './register-user.dto';

export class UpdateDeploymentDto {
  @ApiProperty({
    description: 'The owner of the wallet',
    example: '0x1234567890abcdef',
  })
  @IsString()
  @Address()
  owner: string;

  @ApiProperty({
    description: 'The deployments of the user',
    type: [DeploymentDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  deployments: DeploymentDto[];
}
