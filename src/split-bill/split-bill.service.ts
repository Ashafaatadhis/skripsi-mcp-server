import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class SplitBillService {
  private readonly logger = new Logger(SplitBillService.name);

  constructor(private prisma: PrismaService) {}

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

  async getDebtsByTransactionId(transactionId: string) {
    return this.prisma.debt.findMany({
      where: { transactionId },
    });
  }

  async getDebtById(debtId: string, chatId?: string) {
    if (debtId.length < 36) {
      return this.prisma.debt.findFirst({
        where: {
          id: { startsWith: debtId },
          ...(chatId ? { chatId } : {}),
        },
        include: { transaction: true },
      });
    }
    return this.prisma.debt.findUnique({
      where: { id: debtId },
      include: { transaction: true },
    });
  }
}
