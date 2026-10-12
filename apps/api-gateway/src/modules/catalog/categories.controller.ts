import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';

import { CatalogClient } from './catalog.client.js';
import {
  categoryListSchema,
  type CategoryListDto,
} from './dto/category-list.schema.js';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly client: CatalogClient) {}

  @Get()
  list(@Query({ schema: categoryListSchema }) query: CategoryListDto) {
    return this.client.listCategories({
      page: { limit: query.limit ?? 0, cursor: query.cursor ?? '' },
      parentId: query.parentId ?? '',
    });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.client.getCategory({ id });
  }
}
