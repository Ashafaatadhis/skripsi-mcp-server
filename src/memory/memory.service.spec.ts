import { MemoryService } from './memory.service';

describe('MemoryService', () => {
  let service: MemoryService;
  let prisma: {
    longTermMemory: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    $queryRawUnsafe: jest.Mock;
    $executeRawUnsafe: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      longTermMemory: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      $queryRawUnsafe: jest.fn(),
      $executeRawUnsafe: jest.fn(),
    };

    service = new MemoryService(prisma as any);
    jest.spyOn(service, 'getEmbedding').mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it('inserts new fact memory when canonical key is new', async () => {
    prisma.longTermMemory.findUnique.mockResolvedValue(null);
    prisma.longTermMemory.findFirst.mockResolvedValue(null);
    prisma.$queryRawUnsafe.mockResolvedValue([{ id: 'memory-1' }]);

    await expect(
      service.saveToLongTermMemory({
        chatId: 'chat-1',
        content: 'User gajian tiap tanggal 25.',
        memoryType: 'fact',
        category: 'recurring_pattern',
        canonicalKey: 'recurring_pattern.salary_date',
      }),
    ).resolves.toEqual({ status: 'inserted', memoryId: 'memory-1' });

    expect(prisma.$queryRawUnsafe).toHaveBeenCalled();
  });

  it('refreshes existing fact memory when content is unchanged', async () => {
    prisma.longTermMemory.findUnique.mockResolvedValue({
      id: 'memory-1',
      content: 'User gajian tiap tanggal 25.',
      confidence: 0.9,
      importanceScore: 0.8,
      sourceType: 'system_checkpoint',
      expiresAt: null,
    });

    await expect(
      service.saveToLongTermMemory({
        chatId: 'chat-1',
        content: '  User gajian tiap tanggal 25. ',
        memoryType: 'fact',
        category: 'recurring_pattern',
        canonicalKey: 'recurring_pattern.salary_date',
      }),
    ).resolves.toEqual({ status: 'refreshed', memoryId: 'memory-1' });

    expect(prisma.longTermMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'memory-1' },
      }),
    );
  });

  it('updates existing fact memory when content changes', async () => {
    prisma.longTermMemory.findUnique.mockResolvedValue({
      id: 'memory-1',
      content: 'User target nabung 1 juta per bulan.',
      confidence: 0.9,
      importanceScore: 0.8,
      sourceType: 'system_checkpoint',
      expiresAt: null,
    });

    await expect(
      service.saveToLongTermMemory({
        chatId: 'chat-1',
        content: 'User target nabung 2 juta per bulan.',
        memoryType: 'fact',
        category: 'financial_goal',
        canonicalKey: 'financial_goal.monthly_saving_target',
      }),
    ).resolves.toEqual({ status: 'updated', memoryId: 'memory-1' });

    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
  });

  it('prioritizes fact memory over episode summary on search results', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      {
        content: 'Dalam fase ini user fokus split bill.',
        createdAt: new Date('2026-04-01'),
        updatedAt: new Date('2026-04-01'),
        lastConfirmedAt: new Date('2026-04-01'),
        memoryType: 'episode_summary',
        category: 'episode',
        importanceScore: 0.6,
        mentionCount: 1,
        distance: 0.1,
      },
      {
        content: 'User ingin daftar transaksi tampil lengkap.',
        createdAt: new Date('2026-04-02'),
        updatedAt: new Date('2026-04-02'),
        lastConfirmedAt: new Date('2026-04-02'),
        memoryType: 'fact',
        category: 'preference',
        importanceScore: 0.8,
        mentionCount: 2,
        distance: 0.2,
      },
    ]);

    const result = await service.searchLongTermMemory('chat-1', 'transaksi saya');

    expect(result[0]).toEqual(
      expect.objectContaining({
        memoryType: 'fact',
        content: 'User ingin daftar transaksi tampil lengkap.',
      }),
    );
  });
});
