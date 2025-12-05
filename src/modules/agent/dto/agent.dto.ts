import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AskQuestionDto {
  @ApiProperty({
    description: 'The question to ask',
    example: 'What is Owlia?',
  })
  @IsString()
  @IsNotEmpty()
  question: string;

  @ApiPropertyOptional({
    description: 'Optional custom system prompt',
    example: 'Answer in a concise manner',
  })
  @IsString()
  @IsOptional()
  systemPrompt?: string;
}

export class QuestionResponseDto {
  @ApiProperty({
    description: 'The original question',
    example: 'What is Owlia?',
  })
  question: string;

  @ApiProperty({
    description: 'The AI-generated answer based on documentation',
    example: 'Owlia is a DeFi AI Co-pilot that helps users...',
  })
  answer: string;

  @ApiProperty({
    description: 'Timestamp of the response',
    example: '2025-12-05T10:45:00.000Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Response time in milliseconds',
    example: 1523,
  })
  responseTimeMs: number;
}
