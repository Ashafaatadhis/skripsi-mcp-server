import { SplitBillResolver } from './split-bill.resolver';

describe('SplitBillResolver', () => {
  let resolver: SplitBillResolver;
  let splitBillService: {
    findDebtsByPerson: jest.Mock;
    settleDebt: jest.Mock;
  };
  let transactionService: {
    getTransactions: jest.Mock;
    createTransaction: jest.Mock;
  };

  beforeEach(() => {
    splitBillService = {
      findDebtsByPerson: jest.fn(),
      settleDebt: jest.fn(),
    };

    transactionService = {
      getTransactions: jest.fn(),
      createTransaction: jest.fn(),
    };

    resolver = new SplitBillResolver(splitBillService as any, transactionService as any);
  });

  it('asks for clarification when person name matches multiple active debts', async () => {
    splitBillService.findDebtsByPerson.mockResolvedValue([
      {
        id: 'debt1111-1111-1111-1111-111111111111',
        personName: 'Naufal',
        amount: 15000,
        isPaid: false,
        transaction: { date: new Date('2026-01-02'), merchant: 'Fore' },
      },
      {
        id: 'debt2222-2222-2222-2222-222222222222',
        personName: 'Naufal',
        amount: 25000,
        isPaid: false,
        transaction: { date: new Date('2026-01-03'), merchant: 'KFC' },
      },
    ]);

    const result = await resolver.settleDebt({ chatId: 'chat-1', personName: 'Naufal' });

    expect(splitBillService.settleDebt).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('masih ambigu');
    expect(result.content[0].text).toContain('<code>debt1111</code>');
    expect(result.content[0].text).toContain('<code>debt2222</code>');
  });

  it('does not create repayment transaction when debt is already paid', async () => {
    splitBillService.settleDebt.mockResolvedValue({
      status: 'already_paid',
      record: {
        id: 'debt1111-1111-1111-1111-111111111111',
      },
    });

    const result = await resolver.settleDebt({
      chatId: 'chat-1',
      debtId: 'debt1111',
    });

    expect(transactionService.getTransactions).not.toHaveBeenCalled();
    expect(transactionService.createTransaction).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('sudah berstatus lunas');
  });

  it('does not create duplicate repayment income when one already exists', async () => {
    splitBillService.settleDebt.mockResolvedValue({
      status: 'resolved',
      record: {
        id: 'debt1111-1111-1111-1111-111111111111',
        chatId: 'chat-1',
        personName: 'Naufal',
        amount: 30000,
      },
    });
    transactionService.getTransactions.mockResolvedValue([
      {
        type: 'INCOME',
        category: 'Debt Repayment',
        description: 'Pelunasan utang dari Naufal (DebtID: debt1111)',
      },
    ]);

    const result = await resolver.settleDebt({
      chatId: 'chat-1',
      debtId: 'debt1111',
    });

    expect(transactionService.createTransaction).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('tidak dibuat ulang');
  });
});
