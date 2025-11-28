import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { NetworkDto } from '../../common/dto/network.dto';
import { UniswapV3ProtocolBlockResponseDto } from './uniswap-v3.response.dto';
import { AerodromeCLProtocolBlockResponseDto } from './aerodrome-cl.response.dto';
import { AaveV3ProtocolBlockResponseDto } from './aave-v3.response.dto';
import { EulerV2ProtocolBlockResponseDto } from './euler-v2.response.dto';
import { VenusV4ProtocolBlockResponseDto } from './venus-v4.response.dto';

export class PortfolioMetaResponseDto {
  @ApiProperty({
    description: 'The network of the portfolio',
    enum: NetworkDto,
    default: NetworkDto.Bsc,
  })
  network: NetworkDto;

  @ApiProperty({
    description: 'The chain ID of the portfolio',
    example: 1,
  })
  chainId: number;

  @ApiProperty({
    description: 'The address of the portfolio',
    example: '0x1234567890abcdef',
  })
  address: string;
}

export class PortfolioSummaryResponseDto {
  @ApiProperty({
    description: 'The net USD of the portfolio',
    example: '100.10',
  })
  netUsd: string;

  @ApiProperty({
    description: 'The asset USD of the portfolio',
    example: '100.10',
  })
  assetUsd: string;

  @ApiProperty({
    description: 'The wallet USD of the portfolio',
    example: '100.10',
  })
  walletUsd: string;

  @ApiProperty({
    description: 'The defi USD of the portfolio',
    example: '100.10',
  })
  defiUsd: string;

  @ApiProperty({
    description: 'The debt USD of the portfolio',
    example: '100.10',
  })
  debtUsd: string;

  @ApiProperty({
    description: 'The claimable USD of the portfolio',
    example: '100.10',
  })
  claimableUsd: string;
}

export type ProtocolBlockResponseDto =
  | UniswapV3ProtocolBlockResponseDto
  | AerodromeCLProtocolBlockResponseDto
  | AaveV3ProtocolBlockResponseDto
  | EulerV2ProtocolBlockResponseDto
  | VenusV4ProtocolBlockResponseDto;

export class PortfolioTokenResponseDto {
  @ApiProperty({
    description: 'The token symbol',
    example: 'USDC',
  })
  symbol: string;

  @ApiProperty({
    description: 'The token name',
    example: 'USDC',
  })
  name: string;

  @ApiProperty({
    description: 'The token decimals',
    example: 18,
  })
  decimals: number;

  @ApiProperty({
    description: 'The token price in USD',
    example: '1.00',
  })
  priceUsd: string;
}

export class PortfolioWalletResponseDto {
  @ApiProperty({
    description: 'The token address',
    example: '0x1234567890abcdef',
  })
  tokenAddress: string;

  @ApiProperty({
    description: 'The amount of the token',
    example: '1.00',
  })
  amount: string;

  @ApiProperty({
    description: 'The amount in USD of the token',
    example: '1.00',
  })
  amountUsd: string;
}

@ApiExtraModels(
  UniswapV3ProtocolBlockResponseDto,
  AerodromeCLProtocolBlockResponseDto,
  AaveV3ProtocolBlockResponseDto,
  EulerV2ProtocolBlockResponseDto,
  VenusV4ProtocolBlockResponseDto,
  PortfolioTokenResponseDto,
)
export class PortfolioResponseDto {
  @ApiProperty({
    description: 'The meta data of the portfolio',
    type: PortfolioMetaResponseDto,
  })
  meta: PortfolioMetaResponseDto;

  @ApiProperty({
    description: 'The summary of the portfolio',
    type: PortfolioSummaryResponseDto,
  })
  summary: PortfolioSummaryResponseDto;

  @ApiProperty({
    description: 'The tokens of the portfolio',
    type: 'object',
    additionalProperties: {
      $ref: getSchemaPath(PortfolioTokenResponseDto),
    },
  })
  tokens: Record<string, PortfolioTokenResponseDto>;

  @ApiProperty({
    description: 'The wallet of the portfolio',
    type: [PortfolioWalletResponseDto],
  })
  wallet: PortfolioWalletResponseDto[];

  @ApiProperty({
    description: 'The protocols of the portfolio',
    oneOf: [
      { $ref: getSchemaPath(UniswapV3ProtocolBlockResponseDto) },
      { $ref: getSchemaPath(AerodromeCLProtocolBlockResponseDto) },
      { $ref: getSchemaPath(AaveV3ProtocolBlockResponseDto) },
      { $ref: getSchemaPath(EulerV2ProtocolBlockResponseDto) },
      { $ref: getSchemaPath(VenusV4ProtocolBlockResponseDto) },
    ],
  })
  protocols: ProtocolBlockResponseDto[];
}
