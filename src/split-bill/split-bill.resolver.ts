import { Resolver, Tool } from '@nestjs-mcp/server';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { SplitBillService } from './split-bill.service';
import { TransactionService } from '../transaction/transaction.service';

const participantSchema = z.string().trim().min(1);
const splitItemSchema = z.object({
  name: z.string().trim().min(1),
  price: z.number().nonnegative(),
  qty: z.number().int().positive(),
});

function formatCurrency(amount: number) {
  return `Rp ${amount.toLocaleString('id-ID')}`;
}

function formatDebtCandidate(debt: any) {
  const txInfo = debt.transaction
    ? ` | ${debt.transaction.date.toISOString().split('T')[0]} | ${debt.transaction.merchant ?? 'Transaksi'} `
    : ' | Tanpa transaksi terkait ';
  return `- <code>${debt.id.substring(0, 8)}</code> | ${debt.personName} | ${formatCurrency(debt.amount)}${txInfo}| ${debt.isPaid ? 'LUNAS' : 'BELUM LUNAS'}`;
}

@Resolver('split_bill')
export class SplitBillResolver {
  private readonly logger = new Logger(SplitBillResolver.name);

  constructor(
    private readonly splitBillService: SplitBillService,
    private readonly transactionService: TransactionService
  ) {}

  @Tool({
    name: 'split_bill',
    description: 'Split a bill. If transactionId is provided, it will split an EXISTING transaction. If not, it will create a NEW transaction. IMPORTANT: Make sure totalAmount matches the transaction if transactionId is used.',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
      totalAmount: z.number().positive().describe('The total amount of the bill to be split'),
      transactionId: z.string().optional().describe('ID of an existing transaction to split (e.g. from list_transactions). Use this to avoid duplicate records.'),
      merchant: z.string().optional().describe('Where the bill was from (ignore if transactionId is used)'),
      description: z.string().trim().optional().describe('Common description'),
      category: z.string().trim().optional().describe('Category for the transaction'),
      participants: z
        .array(participantSchema)
        .min(1)
        .refine((participants) => new Set(participants.map((name) => name.toLowerCase())).size === participants.length, {
          message: 'Participants must be unique',
        })
        .describe('List of friends names taking part in the split (DO NOT include yourself)'),
      items: z.array(splitItemSchema).optional().describe('Detailed list of items'),
    },
  })
  async splitBill(params: any) {
    let targetTransactionId = params.transactionId;
    const normalizedParticipants = params.participants.map((name: string) => name.trim());

    // 1. Jika ada transactionId (bisa jadi ID pendek), cari ID aslinya dulu
    if (params.transactionId) {
      const resolvedTx = await this.transactionService.resolveTransactionById(params.transactionId, params.chatId);
      if (resolvedTx.status === 'ambiguous') {
        const options = resolvedTx.matches
          .map(
            (match: any) =>
              `- <code>${match.id.substring(0, 8)}</code> | ${match.date.toISOString().split('T')[0]} | ${match.merchant ?? 'Unknown'} | ${formatCurrency(match.amount)}`,
          )
          .join('\n');
        return {
          content: [
            {
              type: 'text',
              text:
                `<b>⚠️ Transaksi untuk split ambigu</b>\n` +
                `Ada beberapa transaksi yang cocok dengan ID <code>${params.transactionId}</code>.\n` +
                `Balas lagi dengan salah satu ID ini:\n${options}`,
            },
          ],
        };
      }

      if (resolvedTx.status === 'not_found') {
        return {
          content: [
            {
              type: 'text',
              text: `<b>❌ Transaksi tidak ditemukan</b>\n🆔 ID: <code>${params.transactionId}</code>`,
            },
          ],
          isError: true,
        };
      }

      const existingTx = resolvedTx.record;

      if (Math.abs(existingTx.amount - params.totalAmount) > 100) {
        return {
          content: [
            {
              type: 'text',
              text:
                `<b>❌ Total split tidak cocok</b>\n` +
                `Total transaksi lama: <code>${formatCurrency(existingTx.amount)}</code>\n` +
                `Total split yang diminta: <code>${formatCurrency(params.totalAmount)}</code>\n` +
                `Gunakan nominal yang sama agar tidak terjadi data ganda.`,
            },
          ],
          isError: true,
        };
      }

      targetTransactionId = existingTx.id; // Gunakan UUID asli dari DB

      // CEK DUPLIKAT: Apakah transaksi ini sudah pernah di-split?
      const existingDebts = await this.splitBillService.getDebtsByTransactionId(targetTransactionId);
      if (existingDebts.length > 0) {
        const names = existingDebts.map(d => d.personName).join(', ');
        return {
          content: [{
            type: 'text',
            text: `<b>⚠️ Split bill sudah ada</b>\n` +
                  `Transaksi ini sudah pernah dibagi ke: <b>${names}</b>\n` +
                  `Tidak bisa membagi ulang transaksi yang sama untuk menghindari data ganda.`
          }],
        };
      }
    } else {
      // Jika TIDAK ada transactionId, buat transaksi baru
      const transaction = await this.transactionService.createTransaction({
        chatId: params.chatId,
        amount: params.totalAmount,
        type: 'EXPENSE',
        category: params.category || 'Split Bill',
        description: params.description || `Split bill at ${params.merchant || 'Merchant'}`,
        merchant: params.merchant,
        items: params.items,
      });
      targetTransactionId = transaction.id;
    }

    // 2. Hitung pembagian
    const share = Math.round((params.totalAmount / (normalizedParticipants.length + 1)) * 100) / 100;

    // 3. Buat hutang yang tertaut ke ID transaksi tersebut
    const debtPromises = normalizedParticipants.map((person: string) => 
      this.splitBillService.createDebt({
        chatId: params.chatId,
        personName: person,
        amount: share,
        description: `Split from ${params.merchant || params.description || 'Transaction'}`,
        transactionId: targetTransactionId,
      })
    );

    await Promise.all(debtPromises);

    return {
      content: [
        {
          type: 'text',
          text: `<b>✅ Split bill berhasil</b>\n` +
                `👥 Total peserta: <b>${normalizedParticipants.length + 1}</b> orang\n` +
                `🙋 Yang ditagih: <b>${normalizedParticipants.join(', ')}</b>\n` +
                `💵 Total tagihan: <code>${formatCurrency(params.totalAmount)}</code>\n` +
                `💸 Hutang per orang: <code>${formatCurrency(share)}</code>\n` +
                `🆔 TxID: <code>${targetTransactionId.substring(0, 8)}</code>\n` +
                `🧾 Status transaksi: ${targetTransactionId === params.transactionId ? 'Menggunakan transaksi lama' : 'Transaksi baru dicatat'}.`,
        },
      ],
    };
  }

  @Tool({
    name: 'find_debts',
    description: 'Find debts by person name to support clarification before settling or checking debt details.',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
      personName: z.string().trim().min(1).describe('Name of the person to search debts for'),
      status: z.enum(['ALL', 'UNSETTLED', 'PAID']).optional().default('UNSETTLED').describe('Filter by payment status'),
    },
  })
  async findDebts({ chatId, personName, status }: { chatId: string; personName: string; status: string }) {
    const isPaid = status === 'ALL' ? undefined : status === 'PAID';
    const debts = await this.splitBillService.findDebtsByPerson(chatId, personName, isPaid);

    if (debts.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `<b>ℹ️ Tidak ada hutang untuk ${personName}</b>\nCoba cek nama atau ubah filter status.`,
          },
        ],
      };
    }

    const total = debts.reduce((sum, debt) => sum + debt.amount, 0);
    const text = debts.map((debt) => formatDebtCandidate(debt)).join('\n');

    return {
      content: [
        {
          type: 'text',
          text:
            `<b>HASIL PENCARIAN HUTANG</b>\n` +
            `👤 Nama: <b>${personName}</b>\n` +
            `📌 Filter: <b>${status}</b>\n` +
            `💵 Total: <code>${formatCurrency(total)}</code>\n\n${text}`,
        },
      ],
    };
  }

  @Tool({
    name: 'list_debts',
    description: 'List all people who owe you money or have unsettled payments.',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
      status: z.enum(['ALL', 'UNSETTLED', 'PAID']).optional().default('UNSETTLED').describe('Filter by payment status'),
    },
  })
  async listDebts({ chatId, status }: { chatId: string; status: string }) {
    this.logger.log(`Tool list_debts called for ${chatId} (status: ${status})`);
    
    let isPaid: boolean | undefined;
    if (status === 'PAID') isPaid = true;
    else if (status === 'UNSETTLED') isPaid = false;

    const debts = await this.splitBillService.getDebts(chatId, isPaid);
    const total = debts.reduce((sum, debt) => sum + debt.amount, 0);
    const unsettledTotal = debts.filter((debt) => !debt.isPaid).reduce((sum, debt) => sum + debt.amount, 0);
    
    const text = debts
      .map((d: any) => {
        const txInfo = d.transactionId ? ` (🔗 Tx: <code>${d.transactionId.substring(0,8)}</code>)` : '';
        return `👤 <b>${d.personName}</b> - <code>${formatCurrency(d.amount)}</code>\n` +
               `   🆔 DebtID: <code>${d.id.substring(0,8)}</code>${txInfo}\n` +
               `   📝 ${d.description || 'No description'}\n` +
               `   📌 Status: ${d.isPaid ? '✅ Lunas' : '⏳ Belum Lunas'}`;
      })
      .join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: text ? `<b>DAFTAR HUTANG (${status}):</b>\n💵 Total nominal: <code>${formatCurrency(total)}</code>\n⏳ Belum lunas: <code>${formatCurrency(unsettledTotal)}</code>\n\n${text}` : '<b>Tidak ada catatan hutang.</b>',
        },
      ],
    };
  }

  @Tool({
    name: 'settle_debt',
    description: 'Mark a person\'s debt as paid/settled. Prefer debtId, but you can also use personName if the user only mentions the person. If multiple debts match, the tool will ask for clarification.',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
      debtId: z.string().optional().describe('The full ID or the short 8-character ID of the debt'),
      personName: z.string().trim().optional().describe('Person name if the user does not mention a debt ID'),
    },
  })
  async settleDebt({ chatId, debtId, personName }: { chatId: string; debtId?: string; personName?: string }) {
    this.logger.log(`Tool settle_debt called for ${debtId ?? personName}`);
    
    try {
      let targetDebtId = debtId?.trim();

      if (!targetDebtId) {
        if (!personName?.trim()) {
          return {
            content: [{ type: 'text', text: '<b>❌ Butuh debtId atau personName</b>\nSebutkan salah satu agar hutangnya bisa dicari.' }],
            isError: true,
          };
        }

        const candidateDebts = await this.splitBillService.findDebtsByPerson(chatId, personName, false);
        if (candidateDebts.length === 0) {
          return {
            content: [{ type: 'text', text: `<b>ℹ️ Tidak ada hutang aktif atas nama ${personName}</b>` }],
          };
        }

        if (candidateDebts.length > 1) {
          const options = candidateDebts.map((debt) => formatDebtCandidate(debt)).join('\n');
          return {
            content: [
              {
                type: 'text',
                text:
                  `<b>⚠️ Hutang ${personName} masih ambigu</b>\n` +
                  `Ada beberapa hutang aktif atas nama itu. Balas lagi pakai DebtID yang benar:\n${options}`,
              },
            ],
          };
        }

        targetDebtId = candidateDebts[0].id;
      }

      if (!targetDebtId) {
        return {
          content: [{ type: 'text', text: '<b>❌ Debt ID tidak tersedia</b>' }],
          isError: true,
        };
      }

      const settledDebtResult = await this.splitBillService.settleDebt(targetDebtId, chatId);

      if (settledDebtResult.status === 'not_found') {
        return {
          content: [{ type: 'text', text: `<b>❌ Catatan hutang tidak ditemukan</b>\n🆔 Debt ID: <code>${targetDebtId}</code>` }],
          isError: true,
        };
      }

      if (settledDebtResult.status === 'ambiguous') {
        const options = settledDebtResult.matches.map((debt) => formatDebtCandidate(debt)).join('\n');
        return {
          content: [
            {
              type: 'text',
              text:
                `<b>⚠️ Debt ID ambigu</b>\n` +
                `Ada beberapa hutang yang cocok. Balas lagi dengan salah satu DebtID berikut:\n${options}`,
            },
          ],
        };
      }

      if (settledDebtResult.status === 'already_paid') {
        return {
          content: [
            {
              type: 'text',
              text: `<b>ℹ️ Hutang ini sudah berstatus lunas</b>\n🆔 Debt ID: <code>${settledDebtResult.record.id.substring(0, 8)}</code>\nTidak akan dicatat ulang sebagai pemasukan.`,
            },
          ],
        };
      }

      const settledDebt = settledDebtResult.record;
      
      // Otomatis catat sebagai INCOME agar saldo akurat, tetapi hanya sekali.
      const repaymentDescription = `Pelunasan utang dari ${settledDebt.personName} (DebtID: ${settledDebt.id.substring(0,8)})`;
      const existingRepayment = await this.transactionService.getTransactions(chatId, 50);
      const hasRepaymentRecord = existingRepayment.some(
        (transaction: any) =>
          transaction.type === 'INCOME' &&
          transaction.category === 'Debt Repayment' &&
          transaction.description === repaymentDescription,
      );

      if (!hasRepaymentRecord) {
        await this.transactionService.createTransaction({
          chatId: settledDebt.chatId,
          amount: settledDebt.amount,
          type: 'INCOME',
          category: 'Debt Repayment',
          description: repaymentDescription,
          merchant: settledDebt.personName,
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: `<b>✅ Hutang berhasil dilunasi</b>\n` +
                  `👤 Nama: <b>${settledDebt.personName}</b>\n` +
                  `💵 Jumlah: <code>${formatCurrency(settledDebt.amount)}</code>\n` +
                  `📌 Status: <b>LUNAS</b>\n` +
                  `🆔 Debt ID: <code>${settledDebt.id.substring(0,8)}</code>\n` +
                  `💰 ${hasRepaymentRecord ? 'Pemasukan repayment sudah pernah tercatat sebelumnya, jadi tidak dibuat ulang.' : 'Pelunasan juga sudah dicatat sebagai pemasukan (INCOME).'}`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `<b>❌ Gagal melunasi hutang</b>\n${error.message}` }],
        isError: true,
      };
    }
  }

  @Tool({
    name: 'get_debts_by_transaction',
    description: 'Get all debts associated with a specific transaction/bill.',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
      transactionId: z.string().describe('The full or 8-character ID of the transaction'),
    },
  })
  async getDebtsByTransaction({ chatId, transactionId }: { chatId: string; transactionId: string }) {
    this.logger.log(`Tool get_debts_by_transaction called for ${transactionId}`);
    
    // Resolusi ID transaksi dulu
    const txResult = await this.transactionService.resolveTransactionById(transactionId, chatId);
    if (txResult.status === 'ambiguous') {
      const options = txResult.matches
        .map(
          (match: any) =>
            `- <code>${match.id.substring(0, 8)}</code> | ${match.date.toISOString().split('T')[0]} | ${match.merchant ?? 'Unknown'} | ${formatCurrency(match.amount)}`,
        )
        .join('\n');
      return {
        content: [{ type: 'text', text: `<b>⚠️ Transaksi ambigu</b>\nBalas lagi dengan salah satu TxID berikut:\n${options}` }],
      };
    }

    if (txResult.status === 'not_found') {
      return {
        content: [{ type: 'text', text: '<b>❌ Transaksi tidak ditemukan</b>' }],
        isError: true,
      };
    }

    const tx = txResult.record;

    const debts = await this.splitBillService.getDebtsByTransactionId(tx.id);
    const totalDebt = debts.reduce((sum, debt) => sum + debt.amount, 0);
    const paidCount = debts.filter((debt) => debt.isPaid).length;
    
    const membersText = debts
      .map((d: any) => `👤 <b>${d.personName}</b> - <code>Rp ${d.amount.toLocaleString('id-ID')}</code>\n` +
                       `   🆔 DebtID: <code>${d.id.substring(0,8)}</code>\n` +
                       `   📌 Status: ${d.isPaid ? '✅ Lunas' : '⏳ Belum Lunas'}`)
      .join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: membersText ? `<b>ANGGOTA SPLIT BILL</b>\n` +
                              `🏢 Merchant: ${tx.merchant || 'Transaksi'}\n` +
                              `💵 Total transaksi: <code>${formatCurrency(tx.amount)}</code>\n` +
                              `💸 Total piutang: <code>${formatCurrency(totalDebt)}</code>\n` +
                              `✅ Lunas: <b>${paidCount}/${debts.length}</b>\n` +
                              `🆔 TxID: <code>${tx.id.substring(0,8)}</code>\n\n${membersText}` : '<b>Belum ada catatan split untuk transaksi ini.</b>',
        },
      ],
    };
  }

  @Tool({
    name: 'get_debt_detail',
    description: 'Get deep details of a specific debt by its ID (full or 8-character).',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
      debtId: z.string().describe('The ID of the debt record'),
    },
  })
  async getDebtDetail({ chatId, debtId }: { chatId: string; debtId: string }) {
    this.logger.log(`Tool get_debt_detail called for ${debtId}`);
    const resolved = await this.splitBillService.resolveDebtById(debtId, chatId);

    if (resolved.status === 'ambiguous') {
      const options = resolved.matches.map((debt) => formatDebtCandidate(debt)).join('\n');
      return {
        content: [{ type: 'text', text: `<b>⚠️ Debt ID ambigu</b>\nBalas lagi dengan salah satu DebtID berikut:\n${options}` }],
      };
    }

    if (resolved.status === 'not_found') {
      return {
        content: [{ type: 'text', text: `<b>❌ Catatan hutang tidak ditemukan</b>\n🆔 Debt ID: <code>${debtId}</code>` }],
      };
    }

    const d = resolved.record;

    const txInfo = d.transaction 
      ? `\n🔗 <b>Transaksi Terkait:</b>\n   🏢 ${d.transaction.merchant || 'Unknown'}\n   💰 Total Struk: ${formatCurrency(d.transaction.amount)}\n   🆔 TxID: <code>${d.transaction.id.substring(0,8)}</code>`
      : '\nℹ️ Hutang ini tidak tertaut ke transaksi spesifik.';

    const text = `📌 <b>DETAIL HUTANG</b>\n` +
                 `-----------------------------\n` +
                 `👤 <b>Peminjam:</b> ${d.personName}\n` +
                 `💵 <b>Jumlah:</b> ${formatCurrency(d.amount)}\n` +
                 `📅 <b>Dibuat:</b> ${d.createdAt.toISOString().split('T')[0]}\n` +
                 `📝 <b>Keterangan:</b> ${d.description || '-'}\n` +
                 `✅ <b>Status:</b> ${d.isPaid ? 'Lunas' : 'Belum Lunas'}\n` +
                 `🆔 <b>Debt ID:</b> <code>${d.id}</code>\n` +
                 txInfo;

    return {
      content: [{ type: 'text', text }],
    };
  }
}
