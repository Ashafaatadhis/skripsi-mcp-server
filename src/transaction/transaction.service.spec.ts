import { TransactionService } from './transaction.service';

describe('TransactionService', () => {
  let service: TransactionService;
  let prisma: {
    transaction: {
      findMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      transaction: {
        findMany: jest.fn(),
      },
    };

    service = new TransactionService(prisma as any);
  });

  it('returns ambiguous when short transaction ID matches multiple records', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      { id: 'abcd1234-1111-1111-1111-111111111111', date: new Date('2026-01-02') },
      { id: 'abcd1234-2222-2222-2222-222222222222', date: new Date('2026-01-01') },
    ]);

    const result = await service.resolveTransactionById('abcd1234', 'chat-1');

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          chatId: 'chat-1',
          id: { startsWith: 'abcd1234' },
        },
        take: 5,
      }),
    );
    expect(result).toEqual({
      status: 'ambiguous',
      matches: expect.arrayContaining([
        expect.objectContaining({ id: 'abcd1234-1111-1111-1111-111111111111' }),
        expect.objectContaining({ id: 'abcd1234-2222-2222-2222-222222222222' }),
      ]),
    });
  });

  it('returns not_found when no transaction matches', async () => {
    prisma.transaction.findMany.mockResolvedValue([]);

    await expect(service.resolveTransactionById('missing-id', 'chat-1')).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('returns resolved when exact UUID matches one record', async () => {
    const record = { id: '12345678-1234-1234-1234-123456789012' };
    prisma.transaction.findMany.mockResolvedValue([record]);

    await expect(
      service.resolveTransactionById('12345678-1234-1234-1234-123456789012', 'chat-1'),
    ).resolves.toEqual({
      status: 'resolved',
      record,
    });
  });
});
