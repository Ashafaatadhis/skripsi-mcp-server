import { TransactionResolver } from './transaction.resolver';

describe('TransactionResolver', () => {
  let resolver: TransactionResolver;
  let transactionService: {
    createTransaction: jest.Mock;
    findTransactions: jest.Mock;
    listTransactions: jest.Mock;
  };

  beforeEach(() => {
    transactionService = {
      createTransaction: jest.fn(),
      findTransactions: jest.fn(),
      listTransactions: jest.fn(),
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

  describe('addTransaction', () => {
    it('allows negative item prices for discount lines when total matches', async () => {
      transactionService.createTransaction.mockResolvedValue({
        id: 'abcd1234-1111-1111-1111-111111111111',
        amount: 75300,
        type: 'EXPENSE',
        category: 'Groceries',
        merchant: 'TOKO INGGOL',
        items: [
          { name: 'Beras', price: 80000, qty: 1 },
          { name: 'DISCOUNT', price: -4700, qty: 1 },
        ],
      });

      const result = await resolver.addTransaction({
        chatId: 'chat-1',
        amount: 75300,
        type: 'EXPENSE',
        category: 'Groceries',
        merchant: 'TOKO INGGOL',
        items: [
          { name: 'Beras', price: 80000, qty: 1 },
          { name: 'DISCOUNT', price: -4700, qty: 1 },
        ],
      });

      expect(transactionService.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 75300,
          items: expect.arrayContaining([
            expect.objectContaining({ name: 'DISCOUNT', price: -4700 }),
          ]),
        }),
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Transaksi berhasil dicatat');
    });
  });

  describe('listTransactions', () => {
    it('returns paginated transactions with filter summary', async () => {
      transactionService.listTransactions.mockResolvedValue({
        transactions: [
          {
            id: 'abcd1234-1111-1111-1111-111111111111',
            date: new Date('2026-02-01T10:00:00.000Z'),
            type: 'EXPENSE',
            merchant: 'Fore',
            category: 'Food & Beverage',
            amount: 28000,
            items: [],
            debts: [],
          },
        ],
        total: 23,
        page: 2,
        limit: 10,
        hasMore: true,
      });

      const result = await resolver.listTransactions({
        chatId: 'chat-1',
        limit: 10,
        page: 2,
        merchant: 'Fore',
      });

      expect(transactionService.listTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: 'chat-1',
          limit: 10,
          page: 2,
          merchant: 'Fore',
        }),
      );
      expect(result.content[0].text).toContain('DAFTAR TRANSAKSI');
      expect(result.content[0].text).toContain('Halaman: <b>2</b>');
      expect(result.content[0].text).toContain('11-11');
      expect(result.content[0].text).toContain('halaman 3');
      expect(result.content[0].text).toContain('merchant: Fore');
    });

    it('returns error for invalid date range', async () => {
      const result = await resolver.listTransactions({
        chatId: 'chat-1',
        limit: 10,
        page: 1,
        dateFrom: '2026-02-10',
        dateTo: '2026-02-01',
      });

      expect(transactionService.listTransactions).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Rentang tanggal tidak valid');
    });
  });
});
