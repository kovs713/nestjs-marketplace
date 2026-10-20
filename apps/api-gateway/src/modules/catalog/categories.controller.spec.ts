import { createMock } from '@golevelup/ts-vitest';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { CatalogClient } from './catalog.client.js';
import { CategoriesController } from './categories.controller.js';

describe('System-managed category HTTP boundary', () => {
  it('registers only category read routes', () => {
    // when
    const prototype = CategoriesController.prototype;
    const routes = Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => {
        const handler = Object.getOwnPropertyDescriptor(prototype, name)!.value;
        return {
          path: Reflect.getMetadata(PATH_METADATA, handler),
          method: Reflect.getMetadata(METHOD_METADATA, handler),
        };
      });

    // then
    expect(routes).toEqual([
      { path: '/', method: RequestMethod.GET },
      { path: ':id', method: RequestMethod.GET },
    ]);
  });

  it('preserves category listing and parent filtering', async () => {
    // given
    const client = createMock<CatalogClient>();
    client.listCategories.mockResolvedValue({ items: [], nextCursor: '' });
    const controller = new CategoriesController(client);

    // when & then
    await expect(
      controller.list({ limit: 10, cursor: 'cursor', parentId: 'parent-id' }),
    ).resolves.toEqual({ items: [], nextCursor: '' });
    expect(client.listCategories).toHaveBeenCalledExactlyOnceWith({
      page: { limit: 10, cursor: 'cursor' },
      parentId: 'parent-id',
    });
  });

  it('preserves single-category lookup', async () => {
    // given
    const client = createMock<CatalogClient>();
    const category = createMock<
      Awaited<ReturnType<CatalogClient['getCategory']>>
    >({ id: 'category-id' });
    client.getCategory.mockResolvedValue(category);
    const controller = new CategoriesController(client);

    // when & then
    await expect(controller.get('category-id')).resolves.toBe(category);
    expect(client.getCategory).toHaveBeenCalledExactlyOnceWith({
      id: 'category-id',
    });
  });
});
