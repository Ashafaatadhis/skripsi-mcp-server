import { Resolver, Tool } from '@nestjs-mcp/server';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { SplitBillService } from './split-bill.service';
import { TransactionService } from '../transaction/transaction.service';

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
      totalAmount: z.number().describe('The total amount of the bill to be split'),
      transactionId: z.string().optional().describe('ID of an existing transaction to split (e.g. from list_transactions). Use this to avoid duplicate records.'),
      merchant: z.string().optional().describe('Where the bill was from (ignore if transactionId is used)'),
      description: z.string().optional().describe('Common description'),
      category: z.string().describe('Category for the transaction'),
      participants: z.array(z.string()).describe('List of friends names taking part in the split (DO NOT include yourself)'),
      items: z.array(z.object({
        name: z.string(),
        price: z.number(),
        qty: z.number(),
      })).optional().describe('Detailed list of items'),
    },
  })
  async splitBill(params: any) {
    let targetTransactionId = params.transactionId;

    // 1. Jika ada transactionId (bisa jadi ID pendek), cari ID aslinya dulu
    if (params.transactionId) {
      const existingTx = await this.transactionService.getTransactionById(params.transactionId, params.chatId);
      if (!existingTx) {
        throw new Error(`Transaksi dengan ID "${params.transactionId}" tidak ditemukan.`);
      }
      targetTransactionId = existingTx.id; // Gunakan UUID asli dari DB

      // CEK DUPLIKAT: Apakah transaksi ini sudah pernah di-split?
      const existingDebts = await this.splitBillService.getDebtsByTransactionId(targetTransactionId);
      if (existingDebts.length > 0) {
        const names = existingDebts.map(d => d.personName).join(', ');
        return {
          content: [{ 
            type: 'text', 
            text: `⚠️ Transaksi ini sudah pernah dibagi sebelumnya kepada: ${names}. Tidak bisa membagi ulang transaksi yang sama untuk menghindari data ganda.` 
          }],
        };
      }
    } else {
      // Jika TIDAK ada transactionId, buat transaksi baru
      const transaction = await this.transactionService.createTransaction({
        chatId: params.chatId,
        amount: params.totalAmount,
        type: 'EXPENSE',
        category: params.category,
        description: params.description || `Split bill at ${params.merchant || 'Merchant'}`,
        merchant: params.merchant,
        items: params.items,
      });
      targetTransactionId = transaction.id;
    }

    // 2. Hitung pembagian
    const share = params.totalAmount / (params.participants.length + 1);

    // 3. Buat hutang yang tertaut ke ID transaksi tersebut
    const debtPromises = params.participants.map((person: string) => 
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
          text: `Bill of ${params.totalAmount} split successfully among ${params.participants.length + 1} people. ${targetTransactionId === params.transactionId ? '(Menggunakan transaksi lama)' : '(Transaksi baru dicatat)'}. Masing-masing teman berhutang ${share.toLocaleString('id-ID')}.`,
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
    
    const text = debts
      .map((d: any) => {
        const txInfo = d.transactionId ? ` (🔗 Tx: <code>${d.transactionId.substring(0,8)}</code>)` : '';
        return `👤 <b>${d.personName}</b> - <code>Rp ${d.amount.toLocaleString('id-ID')}</code>\n` +
               `   🆔 DebtID: <code>${d.id.substring(0,8)}</code>${txInfo}\n` +
               `   📝 ${d.description || 'No description'}\n` +
               `   📌 Status: ${d.isPaid ? '✅ Lunas' : '⏳ Belum Lunas'}`;
      })
      .join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: text ? `<b>DAFTAR HUTANG (${status}):</b>\n\n${text}` : 'Tidak ada catatan hutang.',
        },
      ],
    };
  }

  @Tool({
    name: 'settle_debt',
    description: 'Mark a person\'s debt as paid/settled. You can use the short 8-character ID.',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
      debtId: z.string().describe('The full ID or the short 8-character ID of the debt'),
    },
  })
  async settleDebt({ chatId, debtId }: { chatId: string; debtId: string }) {
    this.logger.log(`Tool settle_debt called for ${debtId}`);
    
    try {
      const settledDebt = await this.splitBillService.settleDebt(debtId, chatId);
      
      // Otomatis catat sebagai INCOME agar saldo akurat
      await this.transactionService.createTransaction({
        chatId: settledDebt.chatId,
        amount: settledDebt.amount,
        type: 'INCOME',
        category: 'Debt Repayment',
        description: `Pelunasan utang dari ${settledDebt.personName} (ID: ${settledDebt.id.substring(0,8)})`,
        merchant: settledDebt.personName,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Piutang dari ${settledDebt.personName} sebesar ${settledDebt.amount} telah ditandai LUNAS dan dicatat sebagai pemasukan (INCOME). ✅`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
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
    const tx = await this.transactionService.getTransactionById(transactionId, chatId);
    if (!tx) {
      throw new Error('Transaksi tidak ditemukan.');
    }

    const debts = await this.splitBillService.getDebtsByTransactionId(tx.id);
    
    const text = debts
      .map((d: any) => `👤 <b>${d.personName}</b> - <code>Rp ${d.amount.toLocaleString('id-ID')}</code> (${d.isPaid ? '✅' : '⏳'})`)
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: text ? `<b>ANGGOTA SPLIT BILL (${tx.merchant || 'Transaksi'}):</b>\n\n${text}` : 'Belum ada catatan split untuk transaksi ini.',
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
    const d = await this.splitBillService.getDebtById(debtId, chatId);

    if (!d) {
      return {
        content: [{ type: 'text', text: `Catatan hutang dengan ID "${debtId}" tidak ditemukan.` }],
      };
    }

    const txInfo = d.transaction 
      ? `\n🔗 <b>Transaksi Terkait:</b>\n   🏢 ${d.transaction.merchant || 'Unknown'}\n   💰 Total Struk: Rp ${d.transaction.amount.toLocaleString('id-ID')}\n   🆔 TxID: <code>${d.transaction.id.substring(0,8)}</code>`
      : '\nℹ️ Hutang ini tidak tertaut ke transaksi spesifik.';

    const text = `📌 <b>DETAIL HUTANG</b>\n` +
                 `-----------------------------\n` +
                 `👤 <b>Peminjam:</b> ${d.personName}\n` +
                 `💵 <b>Jumlah:</b> Rp ${d.amount.toLocaleString('id-ID')}\n` +
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
