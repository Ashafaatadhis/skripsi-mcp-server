import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

type ResolutionMatch<T> =
  | { status: 'resolved'; record: T }
  | { status: 'not_found' }
  | { status: 'ambiguous'; matches: T[] };

type SettleDebtResult =
  | { status: 'resolved'; record: any }
  | { status: 'already_paid'; record: any }
  | { status: 'not_found' }
  | { status: 'ambiguous'; matches: any[] };

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

  async resolveDebtById(debtId: string, chatId?: string): Promise<ResolutionMatch<any>> {
    const trimmedId = debtId.trim();
    const matches = await this.prisma.debt.findMany({
      where:
        trimmedId.length < 36
          ? {
              id: { startsWith: trimmedId },
              ...(chatId ? { chatId } : {}),
            }
          : {
              id: trimmedId,
              ...(chatId ? { chatId } : {}),
            },
      orderBy: { createdAt: 'desc' },
      take: trimmedId.length < 36 ? 5 : 1,
      include: { transaction: true },
    });

    if (matches.length === 0) {
      return { status: 'not_found' };
    }

    if (matches.length > 1) {
      return { status: 'ambiguous', matches };
    }

    return { status: 'resolved', record: matches[0] };
  }

  async findDebtsByPerson(chatId: string, personName: string, isPaid?: boolean) {
    return this.prisma.debt.findMany({
      where: {
        chatId,
        personName: {
          equals: personName.trim(),
          mode: 'insensitive',
        },
        ...(isPaid !== undefined ? { isPaid } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { transaction: true },
    });
  }

  async settleDebt(debtId: string, chatId?: string): Promise<SettleDebtResult> {
    this.logger.log(`Settling debt ${debtId}`);
    const resolved = await this.resolveDebtById(debtId, chatId);

    if (resolved.status !== 'resolved') {
      return resolved;
    }

    if (resolved.record.isPaid) {
      return { status: 'already_paid', record: resolved.record };
    }

    const updatedDebt = await this.prisma.debt.update({
      where: { id: resolved.record.id },
      data: { isPaid: true },
      include: { transaction: true },
    });
    return { status: 'resolved', record: updatedDebt };
  }

  async getDebtsByTransactionId(transactionId: string) {
    return this.prisma.debt.findMany({
      where: { transactionId },
    });
  }

  async getDebtById(debtId: string, chatId?: string) {
    const resolved = await this.resolveDebtById(debtId, chatId);
    return resolved.status === 'resolved' ? resolved.record : null;
  }
}
