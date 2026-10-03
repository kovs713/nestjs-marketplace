import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { CommonService } from './common.service.js';

describe('CommonService', () => {
  let service: CommonService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CommonService],
    }).compile();

    service = module.get<CommonService>(CommonService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
