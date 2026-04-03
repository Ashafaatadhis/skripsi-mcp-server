import { Resolver, Tool } from '@nestjs-mcp/server';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { TransactionService } from './transaction.service';

const itemSchema = z.object({
  name: z.string().trim().min(1).describe('Item name'),
  price: z.number().describe('Price per unit. Can be negative for discount, promo, or voucher lines.'),
  qty: z.number().int().positive().describe('Quantity'),
});

function formatCurrency(amount: number) {
  return `Rp ${amount.toLocaleString('id-ID')}`;
}

function formatTransactionLine(transaction: any) {
  let itemStr = '';
  if (transaction.items && Array.isArray(transaction.items) && transaction.items.length > 0) {
    const itemsPart = transaction.items.map((item: any) => `${item.name} (x${item.qty})`).join(', ');
    itemStr = `\n   📦 Items: ${itemsPart}`;
  }

  const debtCount = transaction.debts?.length ?? 0;
  const splitInfo = debtCount > 0 ? `\n   👥 Split bill: ${debtCount} peserta terkait` : '';

  return `📅 ${transaction.date.toISOString().split('T')[0]} | ${transaction.type === 'INCOME' ? '💰' : '💸'} <b>${transaction.type}</b>\n` +
         `   🏢 ${transaction.merchant ?? 'Unknown'} (${transaction.category ?? 'N/A'})\n` +
         `   💵 Amount: ${formatCurrency(transaction.amount)}\n` +
         `   🆔 ID: <code>${transaction.id.substring(0, 8)}</code>${itemStr}${splitInfo}\n`;
}

@Resolver('transaction')
export class TransactionResolver {
  private readonly logger = new Logger(TransactionResolver.name);

  constructor(private readonly transactionService: TransactionService) {}

  @Tool({
    name: 'add_transaction',
    description: 'Add a new financial transaction. IMPORTANT: If a merchant name or a list of items is mentioned, you MUST populate the "merchant" and "items" fields specifically. Do NOT just dump them into the description.',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
      amount: z.number().positive().describe('Total amount of the transaction'),
      type: z.enum(['INCOME', 'EXPENSE']).describe('Status as INCOME or EXPENSE'),
      category: z.string().describe('The category of the transaction (e.g., Food & Beverage, Transport, Entertainment, Shopping, Health, Utilities, Salary). If not explicitly mentioned, please categorize it yourself based on the merchant or items.'),
      description: z.string().optional().describe('General notes, but do NOT include item lists or merchant name here if those fields are available'),
      merchant: z.string().optional().describe('The store, restaurant, or person. DO NOT LEAVE NULL IF MENTIONED.'),
      items: z.array(itemSchema).optional().describe('Detailed list of products/services bought. USE THIS for structured receipt data.'),
    },
  })
  async addTransaction(params: any) {
    this.logger.log(`Tool add_transaction called with params: ${JSON.stringify(params)}`);
    if (params.items?.length) {
      const itemsTotal = params.items.reduce((sum: number, item: any) => sum + item.price * item.qty, 0);
      if (Math.abs(itemsTotal - params.amount) > 100) {
        return {
          content: [
            {
              type: 'text',
              text:
                `<b>❌ Total transaksi tidak konsisten</b>\n` +
                `💵 Amount: <code>${formatCurrency(params.amount)}</code>\n` +
                `📦 Total item: <code>${formatCurrency(itemsTotal)}</code>\n` +
                `Samakan nominal total dengan subtotal item dulu ya.`,
            },
          ],
          isError: true,
        };
      }
    }

    const transaction = await this.transactionService.createTransaction(params);
    const itemSummary =
      transaction.items && Array.isArray(transaction.items) && transaction.items.length > 0
        ? `\n📦 Item: <b>${transaction.items.length}</b> jenis`
        : '';

    return {
      content: [
        {
          type: 'text',
          text: `<b>✅ Transaksi berhasil dicatat</b>\n` +
                `🧾 Tipe: <b>${transaction.type}</b>\n` +
                `🏷️ Kategori: <b>${transaction.category ?? '-'}</b>\n` +
                `🏢 Merchant: <b>${transaction.merchant ?? '-'}</b>\n` +
                `💵 Jumlah: <code>${formatCurrency(transaction.amount)}</code>\n` +
                `🆔 ID: <code>${transaction.id.substring(0, 8)}</code>${itemSummary}`,
        },
      ],
    };
  }

  @Tool({
    name: 'get_balance',
    description: 'Get current balance, total income, and total expense for a chat ID',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
    },
  })
  async getBalance({ chatId }: { chatId: string }) {
    this.logger.log(`Tool get_balance called for ${chatId}`);
    const res = await this.transactionService.getBalance(chatId);
    return {
      content: [
        {
          type: 'text',
          text: `<b>RINGKASAN SALDO</b>\n` +
                `💰 Income: <code>${formatCurrency(res.income)}</code>\n` +
                `💸 Expense: <code>${formatCurrency(res.expense)}</code>\n` +
                `📌 Total Balance: <code>${formatCurrency(res.balance)}</code>\n` +
                `🧾 Total transaksi: <b>${res.totalTransactions}</b>`,
        },
      ],
    };
  }

  @Tool({
    name: 'list_transactions',
    description: 'List transactions with pagination and optional filters. Use this instead of dumping all transactions at once.',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
      limit: z.number().int().positive().max(20).optional().default(10).describe('Maximum number of transactions per page'),
      page: z.number().int().positive().optional().default(1).describe('Page number starting from 1'),
      type: z.enum(['INCOME', 'EXPENSE']).optional().describe('Filter by transaction type'),
      category: z.string().trim().optional().describe('Filter by category'),
      merchant: z.string().trim().optional().describe('Filter by merchant name'),
      dateFrom: z.string().optional().describe('Start date in YYYY-MM-DD format'),
      dateTo: z.string().optional().describe('End date in YYYY-MM-DD format'),
    },
  })
  async listTransactions(params: {
    chatId: string;
    limit: number;
    page: number;
    type?: 'INCOME' | 'EXPENSE';
    category?: string;
    merchant?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    this.logger.log(`Tool list_transactions called with params: ${JSON.stringify(params)}`);

    const dateFrom = params.dateFrom ? new Date(`${params.dateFrom}T00:00:00.000Z`) : undefined;
    const dateTo = params.dateTo ? new Date(`${params.dateTo}T23:59:59.999Z`) : undefined;

    if ((dateFrom && Number.isNaN(dateFrom.getTime())) || (dateTo && Number.isNaN(dateTo.getTime()))) {
      return {
        content: [
          {
            type: 'text',
            text: '<b>❌ Format tanggal tidak valid</b>\nGunakan format <code>YYYY-MM-DD</code>.',
          },
        ],
        isError: true,
      };
    }

    if (dateFrom && dateTo && dateFrom > dateTo) {
      return {
        content: [
          {
            type: 'text',
            text: '<b>❌ Rentang tanggal tidak valid</b>\n<code>dateFrom</code> tidak boleh lebih besar dari <code>dateTo</code>.',
          },
        ],
        isError: true,
      };
    }

    const result = await this.transactionService.listTransactions({
      chatId: params.chatId,
      limit: params.limit,
      page: params.page,
      type: params.type,
      category: params.category,
      merchant: params.merchant,
      dateFrom,
      dateTo,
    });

    const activeFilters = [
      params.type ? `tipe: ${params.type}` : null,
      params.category ? `kategori: ${params.category}` : null,
      params.merchant ? `merchant: ${params.merchant}` : null,
      params.dateFrom || params.dateTo ? `tanggal: ${params.dateFrom ?? 'awal'} s/d ${params.dateTo ?? 'akhir'}` : null,
    ].filter(Boolean);

    const startIndex = result.total === 0 ? 0 : (result.page - 1) * result.limit + 1;
    const endIndex = (result.page - 1) * result.limit + result.transactions.length;
    const text = result.transactions.map((transaction: any) => formatTransactionLine(transaction)).join('---\n');
    
    return {
      content: [
        {
          type: 'text',
          text: text
            ? `<b>DAFTAR TRANSAKSI</b>\n` +
              `📄 Halaman: <b>${result.page}</b>\n` +
              `🧾 Menampilkan: <b>${startIndex}-${endIndex}</b> dari <b>${result.total}</b> transaksi\n` +
              `📌 Filter: ${activeFilters.length > 0 ? `<b>${activeFilters.join(' | ')}</b>` : '<b>tanpa filter khusus</b>'}` +
              `${result.hasMore ? `\n➡️ Masih ada halaman berikutnya. Coba minta <b>halaman ${result.page + 1}</b>.` : ''}` +
              `\n\n${text}`
            : '<b>Belum ada transaksi yang cocok.</b>',
        },
      ],
    };
  }

  @Tool({
    name: 'find_transactions',
    description: 'Find transactions without using ID. Use this when the user mentions merchant, category, free-text keywords, transaction type, or date range.',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
      query: z.string().trim().optional().describe('Free-text keyword to search in merchant, category, or description'),
      merchant: z.string().trim().optional().describe('Merchant name filter'),
      category: z.string().trim().optional().describe('Category filter'),
      type: z.enum(['INCOME', 'EXPENSE']).optional().describe('Transaction type filter'),
      dateFrom: z.string().optional().describe('Start date in YYYY-MM-DD format'),
      dateTo: z.string().optional().describe('End date in YYYY-MM-DD format'),
      limit: z.number().int().positive().max(20).optional().default(10).describe('Maximum number of matching transactions'),
    },
  })
  async findTransactions(params: {
    chatId: string;
    query?: string;
    merchant?: string;
    category?: string;
    type?: 'INCOME' | 'EXPENSE';
    dateFrom?: string;
    dateTo?: string;
    limit: number;
  }) {
    this.logger.log(`Tool find_transactions called with params: ${JSON.stringify(params)}`);

    const dateFrom = params.dateFrom ? new Date(`${params.dateFrom}T00:00:00.000Z`) : undefined;
    const dateTo = params.dateTo ? new Date(`${params.dateTo}T23:59:59.999Z`) : undefined;

    if ((dateFrom && Number.isNaN(dateFrom.getTime())) || (dateTo && Number.isNaN(dateTo.getTime()))) {
      return {
        content: [
          {
            type: 'text',
            text: '<b>❌ Format tanggal tidak valid</b>\nGunakan format <code>YYYY-MM-DD</code>.',
          },
        ],
        isError: true,
      };
    }

    if (dateFrom && dateTo && dateFrom > dateTo) {
      return {
        content: [
          {
            type: 'text',
            text: '<b>❌ Rentang tanggal tidak valid</b>\n<code>dateFrom</code> tidak boleh lebih besar dari <code>dateTo</code>.',
          },
        ],
        isError: true,
      };
    }

    const transactions = await this.transactionService.findTransactions({
      chatId: params.chatId,
      query: params.query,
      merchant: params.merchant,
      category: params.category,
      type: params.type,
      dateFrom,
      dateTo,
      limit: params.limit,
    });

    if (transactions.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: '<b>ℹ️ Tidak ada transaksi yang cocok</b>\nCoba ganti keyword, merchant, kategori, atau rentang tanggal.',
          },
        ],
      };
    }

    const totalAmount = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
    const activeFilters = [
      params.query ? `keyword: ${params.query}` : null,
      params.merchant ? `merchant: ${params.merchant}` : null,
      params.category ? `kategori: ${params.category}` : null,
      params.type ? `tipe: ${params.type}` : null,
      params.dateFrom || params.dateTo ? `tanggal: ${params.dateFrom ?? 'awal'} s/d ${params.dateTo ?? 'akhir'}` : null,
    ].filter(Boolean);

    const text = transactions.map((transaction: any) => formatTransactionLine(transaction)).join('---\n');

    return {
      content: [
        {
          type: 'text',
          text:
            `<b>HASIL PENCARIAN TRANSAKSI</b>\n` +
            `📌 Filter: ${activeFilters.length > 0 ? `<b>${activeFilters.join(' | ')}</b>` : '<b>tanpa filter khusus</b>'}\n` +
            `🧾 Ditemukan: <b>${transactions.length}</b> transaksi\n` +
            `💵 Total nominal: <code>${formatCurrency(totalAmount)}</code>\n\n${text}`,
        },
      ],
    };
  }

  @Tool({
    name: 'get_transaction_by_id',
    description: 'Get details of a specific transaction by its full ID or 8-character short ID.',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
      transactionId: z.string().describe('The full UUID or the short 8-character ID'),
    },
  })
  async getTransactionById({ chatId, transactionId }: { chatId: string; transactionId: string }) {
    this.logger.log(`Tool get_transaction_by_id called for ${transactionId}`);
    const resolved = await this.transactionService.resolveTransactionById(transactionId, chatId);

    if (resolved.status === 'ambiguous') {
      const options = resolved.matches
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
              `<b>⚠️ ID transaksi ambigu</b>\n` +
              `Ada beberapa transaksi yang cocok dengan ID <code>${transactionId}</code>.\n` +
              `Balas lagi dengan salah satu ID berikut:\n${options}`,
          },
        ],
      };
    }
    
    if (resolved.status === 'not_found') {
      return {
        content: [
          {
            type: 'text',
            text:
              `<b>❌ Transaksi tidak ditemukan</b>\n` +
              `🆔 ID: <code>${transactionId}</code>\n` +
              `Coba ambil ID dari <b>list_transactions</b> lalu kirim ulang ID yang lebih spesifik.`,
          },
        ],
      };
    }

    const t = resolved.record;

    let itemStr = '';
    if (t.items && Array.isArray(t.items) && t.items.length > 0) {
      const itemsPart = t.items
        .map((i: any) => `   - ${i.name} x${i.qty} = ${formatCurrency(i.price * i.qty)}`)
        .join('\n');
      itemStr = `\n📦 <b>Items:</b>\n${itemsPart}`;
    }

    const paidDebts = t.debts?.filter((debt: any) => debt.isPaid).length ?? 0;
    const totalDebts = t.debts?.length ?? 0;
    const splitStr =
      totalDebts > 0
        ? `\n👥 <b>Split bill:</b> ${paidDebts}/${totalDebts} hutang sudah lunas`
        : `\n👥 <b>Split bill:</b> Tidak ada hutang terkait`;

    const text = `📅 ${t.date.toISOString().split('T')[0]} | ${t.type === 'INCOME' ? '💰' : '💸'} <b>${t.type}</b>\n` +
                 `   🏢 ${t.merchant ?? 'Unknown'} (${t.category ?? 'N/A'})\n` +
                 `   💵 Amount: ${formatCurrency(t.amount)}\n` +
                 `   📝 Description: ${t.description || '-'}\n` +
                 `   🕒 Dicatat: ${t.createdAt.toISOString().split('T')[0]}\n` +
                 `   🆔 ID: <code>${t.id}</code>${itemStr}${splitStr}`;

    return {
      content: [{ type: 'text', text }],
    };
  }
}
