import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import {
  Address,
  AddressOptional,
} from '../../../common/decorators/address.decorator';
import { Type } from 'class-transformer';
import { LendingProtocolDto } from './rebalance-position.dto';

export enum ActionTypeDto {
  Swap = 'Swap',
  Supply = 'Supply',
  Withdraw = 'Withdraw',
  Borrow = 'Borrow',
  Repay = 'Repay',
}

export type ActionDto = RebalanceActionDto | MintActionDto | BurnActionDto;

export class RebalanceActionDto {
  @ApiProperty({
    description: 'The action type',
    example: ActionTypeDto.Swap,
  })
  actionType: ActionTypeDto;
  @ApiProperty({
    description: 'The token A',
    example: '0x1234567890123456789012345678901234567890',
  })
  @Address()
  tokenA: string;
  @ApiProperty({
    description: 'The token B',
    example: '0x1234567890123456789012345678901234567890',
  })
  @Address()
  tokenB: string;
  @ApiProperty({
    description: 'The amount',
    example: '1000000000000000000',
  })
  amount: string;
  @ApiProperty({
    description: 'The estimated output',
    example: '1000000000000000000',
  })
  estimatedOutput?: string;
  @ApiProperty({
    description: 'The data',
    example: '0x1234567890123456789012345678901234567890',
  })
  data: string;
  @ApiProperty({
    description: 'The protocol',
    example: LendingProtocolDto.Aave,
  })
  protocol: LendingProtocolDto;
  @ApiProperty({
    description: 'The router address',
    example: '0x1234567890123456789012345678901234567890',
  })
  @AddressOptional()
  routerAddress?: string;
}

export enum BurnActionTypeDto {
  UniswapV3Burn = 'UniswapV3Burn',
  AerodromeSlipstreamBurn = 'AerodromeSlipstreamBurn',
}

export class BurnActionDto {
  @ApiProperty({
    description: 'The action type',
    example: BurnActionTypeDto.UniswapV3Burn,
  })
  actionType: BurnActionTypeDto;
  @ApiProperty({
    description: 'The pool id',
    example: '0x1234567890123456789012345678901234567890',
  })
  @Address()
  poolId: string;
  @ApiProperty({
    description: 'The token id',
    example: '1',
  })
  @Address()
  tokenId: string;
  @ApiProperty({
    description: 'The amount 0',
    example: '1000000000000000000',
  })
  amount0: string;
  @ApiProperty({
    description: 'The amount 1',
    example: '1000000000000000000',
  })
  amount1: string;
  @ApiProperty({
    description: 'The liquidity',
    example: '1000000000000000000',
  })
  liquidity: string;
  @ApiProperty({
    description: 'The deadline',
    example: '1000000000000000000',
  })
  deadline: string;
}

export enum MintActionTypeDto {
  UniswapV3Mint = 'UniswapV3Mint',
  AerodromeSlipstreamMint = 'AerodromeSlipstreamMint',
}

export class MintActionDto {
  @ApiProperty({
    description: 'The action type',
    example: MintActionTypeDto.UniswapV3Mint,
  })
  actionType: MintActionTypeDto;
  @ApiProperty({
    description: 'The token 0',
    example: '0x1234567890123456789012345678901234567890',
  })
  poolId: string;
  @ApiProperty({
    description: 'The token 0',
    example: '0x1234567890123456789012345678901234567890',
  })
  token0: string;
  @ApiProperty({
    description: 'The token 1',
    example: '0x1234567890123456789012345678901234567890',
  })
  token1: string;
  @ApiProperty({
    description: 'The fee',
    example: '100',
  })
  fee: number;
  @ApiProperty({
    description: 'The tick spacing',
    example: 100,
  })
  tickSpacing: number;
  @ApiProperty({
    description: 'The tick lower',
    example: 1000000000000000000,
  })
  tickLower: number;
  @ApiProperty({
    description: 'The tick upper',
    example: 1000000000000000000,
  })
  tickUpper: number;
  @ApiProperty({
    description: 'The amount 0',
    example: '1000000000000000000',
  })
  amount0: string;
  @ApiProperty({
    description: 'The amount 1',
    example: '1000000000000000000',
  })
  amount1: string;
  @ApiProperty({
    description: 'The deadline',
    example: '1000000000000000000',
  })
  deadline: string;
}

@ApiExtraModels(RebalanceActionDto, MintActionDto, BurnActionDto)
export class RebalancePositionParamsDto {
  @ApiProperty({
    description: 'The safe address',
    example: '0x1234567890123456789012345678901234567890',
  })
  @Address()
  safe: string;
  @ApiProperty({
    description: 'The routes',
    oneOf: [
      { $ref: getSchemaPath(RebalanceActionDto) },
      { $ref: getSchemaPath(MintActionDto) },
      { $ref: getSchemaPath(BurnActionDto) },
    ],
  })
  @Type(() => Object, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: 'type',
      subTypes: [
        { value: RebalanceActionDto, name: ActionTypeDto.Swap },
        { value: RebalanceActionDto, name: ActionTypeDto.Supply },
        { value: RebalanceActionDto, name: ActionTypeDto.Withdraw },
        { value: RebalanceActionDto, name: ActionTypeDto.Borrow },
        { value: RebalanceActionDto, name: ActionTypeDto.Repay },
        { value: MintActionDto, name: MintActionTypeDto.UniswapV3Mint },
        {
          value: MintActionDto,
          name: MintActionTypeDto.AerodromeSlipstreamMint,
        },
        { value: BurnActionDto, name: BurnActionTypeDto.UniswapV3Burn },
        {
          value: BurnActionDto,
          name: BurnActionTypeDto.AerodromeSlipstreamBurn,
        },
      ],
    },
  })
  routes: ActionDto[];
}

export class ExecuteRebalancePositionResponseDto {
  @ApiProperty({
    description: 'The transactions',
    example: '0x1234567890123456789012345678901234567890',
  })
  txHash: string;
}
