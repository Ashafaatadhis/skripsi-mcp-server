import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

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

  async getTransactionById(id: string, chatId: string) {
    // Jika ID pendek (8 karakter), cari pakai startsWith
    if (id.length === 8) {
      return this.prisma.transaction.findFirst({
        where: {
          chatId,
          id: { startsWith: id },
        },
      });
    }

    // Jika ID panjang, cari langsung
    return this.prisma.transaction.findFirst({
      where: { id, chatId },
    });
  }
}
