// src/finance/finance.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
 

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(private prisma: PrismaService) {}

  async createTransaction(data: {
    chatId: string;
    amount: number;
    category?: string;
    type: string;
    description?: string;
    merchant?: string;
    items?: any;
    date?: Date;
  }) {
    this.logger.log(`Creating transaction for ${data.chatId}: ${data.type} ${data.amount}`);
    return this.prisma.transaction.create({
      data,
    });
  }

  async getTransactions(chatId: string, limit = 10) {
    this.logger.debug(`Fetching last ${limit} transactions for ${chatId}`);
    return this.prisma.transaction.findMany({
      where: { chatId },
      orderBy: { date: 'desc' },
      take: limit,
    });
  }

  async getBalance(chatId: string) {
    this.logger.log(`Calculating balance for ${chatId}`);
    const transactions = await this.prisma.transaction.findMany({
      where: { chatId },
    });

    const income = transactions
      .filter((t) => t.type === 'INCOME')
      .reduce((sum, t) => sum + t.amount, 0);
    const expense = transactions
      .filter((t) => t.type === 'EXPENSE')
      .reduce((sum, t) => sum + t.amount, 0);

    return {
      income,
      expense,
      balance: income - expense,
    };
  }

  async createDebt(data: {
    chatId: string;
    personName: string;
    amount: number;
    description?: string;
    transactionId?: string;
  }) {
    this.logger.log(`Creating debt for ${data.personName} in chat ${data.chatId}: ${data.amount}`);
    return this.prisma.debt.create({
      data,
    });
  }

  async getDebts(chatId: string, isPaid?: boolean) {
    this.logger.debug(`Fetching debts for ${chatId} (isPaid: ${isPaid})`);
    return this.prisma.debt.findMany({
      where: {
        chatId,
        ...(isPaid !== undefined ? { isPaid } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async settleDebt(debtId: string, chatId?: string) {
    this.logger.log(`Settling debt ${debtId}`);
    
    // Jika debtId kurang dari 36 (panjang UUID), cari yang mirip
    if (debtId.length < 36) {
      const debt = await this.prisma.debt.findFirst({
        where: {
          id: { startsWith: debtId },
          ...(chatId ? { chatId } : {}),
        },
      });
      if (!debt) throw new Error('Debt record not found with that short ID');
      debtId = debt.id;
    }

    const updatedDebt = await this.prisma.debt.update({
      where: { id: debtId },
      data: { isPaid: true },
    });
    return updatedDebt;
  }
}