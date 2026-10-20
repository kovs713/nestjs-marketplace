import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { validateUuid } from '@app/common/utils/validation.util.js';
import { JwtAuthGuard } from '@app/jwt';

import { CurrentUser } from '../decorators/current-user.decorator.js';
import {
  type MarkAllReadDto,
  markAllReadSchema,
} from '../dto/mark-all-read.schema.js';
import { type QueryDto, querySchema } from '../dto/query.schema.js';
import { fromProtoType, toProto } from '../mappers/proto.mapper.js';
import { NotificationService } from './notification.service.js';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationHttpController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  async list(
    @CurrentUser() user: string,
    @Query({ schema: querySchema }) dto: QueryDto,
  ) {
    const page = await this.service.list(user, {
      page: { limit: dto.limit ?? 0, cursor: dto.cursor ?? '' },
      types: dto.types.map(fromProtoType),
      unreadOnly: dto.unreadOnly,
    });

    return {
      items: page.items.map(toProto),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':id')
  async get(@CurrentUser() user: string, @Param('id') id: string) {
    validateUuid(id);

    return toProto(await this.service.get(user, id));
  }

  @Patch(':id/read')
  async markRead(@CurrentUser() user: string, @Param('id') id: string) {
    validateUuid(id);

    return toProto(await this.service.markRead(user, id));
  }

  @Post('read-all')
  markAllRead(
    @CurrentUser() user: string,
    @Body({ schema: markAllReadSchema }) dto: MarkAllReadDto,
  ) {
    return this.service
      .markAllRead(user, (dto.types ?? []).map(fromProtoType))
      .then((updated) => ({ updated }));
  }
}
