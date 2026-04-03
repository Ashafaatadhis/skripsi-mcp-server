import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type ResolutionMatch<T> =
  | { status: 'resolved'; record: T }
  | { status: 'not_found' }
  | { status: 'ambiguous'; matches: T[] };

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
      include: {
        debts: {
          select: {
            id: true,
            personName: true,
            amount: true,
            isPaid: true,
          },
        },
      },
    });
  }

  async listTransactions(params: {
    chatId: string;
    limit?: number;
    page?: number;
    type?: string;
    category?: string;
    merchant?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }) {
    const {
      chatId,
      limit = 10,
      page = 1,
      type,
      category,
      merchant,
      dateFrom,
      dateTo,
    } = params;

    const where = {
      chatId,
      ...(type ? { type } : {}),
      ...(merchant
        ? {
            merchant: {
              contains: merchant,
              mode: 'insensitive' as const,
            },
          }
        : {}),
      ...(category
        ? {
            category: {
              contains: category,
              mode: 'insensitive' as const,
            },
          }
        : {}),
      ...(dateFrom || dateTo
        ? {
            date: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    };

    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: limit,
        include: {
          debts: {
            select: {
              id: true,
              personName: true,
              amount: true,
              isPaid: true,
            },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      transactions,
      total,
      page,
      limit,
      hasMore: skip + transactions.length < total,
    };
  }

  async findTransactions(params: {
    chatId: string;
    query?: string;
    merchant?: string;
    category?: string;
    type?: string;
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
  }) {
    const { chatId, query, merchant, category, type, dateFrom, dateTo, limit = 10 } = params;

    return this.prisma.transaction.findMany({
      where: {
        chatId,
        ...(type ? { type } : {}),
        ...(merchant
          ? {
              merchant: {
                contains: merchant,
                mode: 'insensitive',
              },
            }
          : {}),
        ...(category
          ? {
              category: {
                contains: category,
                mode: 'insensitive',
              },
            }
          : {}),
        ...(query
          ? {
              OR: [
                {
                  merchant: {
                    contains: query,
                    mode: 'insensitive',
                  },
                },
                {
                  category: {
                    contains: query,
                    mode: 'insensitive',
                  },
                },
                {
                  description: {
                    contains: query,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
        ...(dateFrom || dateTo
          ? {
              date: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: 'desc' },
      take: limit,
      include: {
        debts: {
          select: {
            id: true,
            personName: true,
            amount: true,
            isPaid: true,
          },
        },
      },
    });
  }

  async getBalance(chatId: string) {
    this.logger.log(`Calculating balance for ${chatId}`);
    const [incomeAgg, expenseAgg, totalTransactions] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { chatId, type: 'INCOME' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { chatId, type: 'EXPENSE' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.count({ where: { chatId } }),
    ]);

    const income = incomeAgg._sum.amount ?? 0;
    const expense = expenseAgg._sum.amount ?? 0;

    return {
      income,
      expense,
      balance: income - expense,
      totalTransactions,
    };
  }

  async resolveTransactionById(id: string, chatId: string): Promise<ResolutionMatch<any>> {
    const trimmedId = id.trim();
    const where =
      trimmedId.length < 36
        ? {
            chatId,
            id: { startsWith: trimmedId },
          }
        : {
            chatId,
            id: trimmedId,
          };

    const matches = await this.prisma.transaction.findMany({
      where,
      orderBy: { date: 'desc' },
      take: trimmedId.length < 36 ? 5 : 1,
      include: {
        debts: {
          select: {
            id: true,
            personName: true,
            amount: true,
            isPaid: true,
          },
        },
      },
    });

    if (matches.length === 0) {
      return { status: 'not_found' };
    }

    if (matches.length > 1) {
      return { status: 'ambiguous', matches };
    }

    return { status: 'resolved', record: matches[0] };
  }

  async getTransactionById(id: string, chatId: string) {
    const resolved = await this.resolveTransactionById(id, chatId);
    return resolved.status === 'resolved' ? resolved.record : null;
  }
}
