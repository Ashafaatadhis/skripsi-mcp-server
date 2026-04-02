import { TransactionResolver } from './transaction.resolver';

describe('TransactionResolver', () => {
  let resolver: TransactionResolver;
  let transactionService: {
    findTransactions: jest.Mock;
  };

  beforeEach(() => {
    transactionService = {
      findTransactions: jest.fn(),
    };

    resolver = new TransactionResolver(transactionService as any);
  });

  describe('findTransactions', () => {
    it('returns error for invalid date format', async () => {
      const result = await resolver.findTransactions({
        chatId: 'chat-1',
        dateFrom: '2026-13-40',
        limit: 10,
      });

      expect(transactionService.findTransactions).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Format tanggal tidak valid');
    });

    it('returns error when dateFrom is after dateTo', async () => {
      const result = await resolver.findTransactions({
        chatId: 'chat-1',
        dateFrom: '2026-02-10',
        dateTo: '2026-02-01',
        limit: 10,
      });

      expect(transactionService.findTransactions).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Rentang tanggal tidak valid');
    });

    it('returns formatted transactions for matching search', async () => {
      transactionService.findTransactions.mockResolvedValue([
        {
          id: 'abcd1234-1111-1111-1111-111111111111',
          date: new Date('2026-02-01T10:00:00.000Z'),
          type: 'EXPENSE',
          merchant: 'Fore',
          category: 'Food & Beverage',
          amount: 28000,
          items: [{ name: 'Iced Americano', qty: 1 }],
          debts: [],
        },
      ]);

      const result = await resolver.findTransactions({
        chatId: 'chat-1',
        merchant: 'Fore',
        type: 'EXPENSE',
        limit: 10,
      });

      expect(transactionService.findTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: 'chat-1',
          merchant: 'Fore',
          type: 'EXPENSE',
          limit: 10,
        }),
      );
      expect(result.content[0].text).toContain('HASIL PENCARIAN TRANSAKSI');
      expect(result.content[0].text).toContain('<code>abcd1234</code>');
      expect(result.content[0].text).toContain('Fore');
    });
  });
});
