import { ApiProperty } from '@nestjs/swagger';

export class TransactionResponseDto {
  @ApiProperty({
    description: 'The job ID',
    example: '123',
  })
  jobId: string;

  @ApiProperty({
    description: 'The transaction hash',
    example: '0x1234567890123456789012345678901234567890',
  })
  txHash: string;

  @ApiProperty({
    description: 'The transaction time',
    example: '2021-01-01T00:00:00.000Z',
  })
  txTime: Date;

  @ApiProperty({
    description: 'The account yield summary',
    example: {
      token0: '1000',
      token1: '2000',
    },
  })
  accountYieldSummary: any;

  @ApiProperty({
    description: 'The parsed transaction',
    example: {
      transactionHash: '0x1234567890123456789012345678901234567890',
      blockNumber: 1234567890,
      timestamp: 1717334400,
    },
  })
  parsedTransaction: any;
}

export class PaginationResponseDto {
  @ApiProperty({
    description: 'The page number',
    example: 1,
  })
  page: number;
  @ApiProperty({
    description: 'The page size',
    example: 10,
  })
  pageSize: number;

  @ApiProperty({
    description: 'The total number of items',
    example: 100,
  })
  total: number;
  @ApiProperty({
    description: 'The total number of pages',
    example: 10,
  })
  totalPages: number;
}

export class TransactionsResponseDto {
  @ApiProperty({
    description: 'The success of the response',
    example: true,
  })
  success: boolean;
  @ApiProperty({
    description: 'The transactions',
    type: [TransactionResponseDto],
  })
  data: TransactionResponseDto[];
  @ApiProperty({
    description: 'The pagination of the response',
    type: PaginationResponseDto,
  })
  pagination: PaginationResponseDto;
}
