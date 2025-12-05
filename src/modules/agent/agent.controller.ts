import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DocService } from './docs.service';
import { AskQuestionDto, QuestionResponseDto } from './dto/agent.dto';

@ApiTags('Agent')
@Controller('agent')
export class AgentController {
  constructor(private readonly docService: DocService) {}

  @Post('ask')
  @ApiOperation({ summary: 'Ask a question based on Owlia documentation' })
  @ApiResponse({
    status: 200,
    description: 'Question answered successfully',
    type: QuestionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async askQuestion(@Body() dto: AskQuestionDto): Promise<QuestionResponseDto> {
    const answer = await this.docService.answerWithDocs(dto.question, dto.systemPrompt);

    return {
      question: dto.question,
      answer,
      timestamp: new Date().toISOString(),
    };
  }
}
