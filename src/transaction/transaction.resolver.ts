import { Resolver, Tool } from '@nestjs-mcp/server';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { TransactionService } from './transaction.service';

@Resolver('transaction')
export class TransactionResolver {
  private readonly logger = new Logger(TransactionResolver.name);

  constructor(private readonly transactionService: TransactionService) {}

  @Tool({
    name: 'add_transaction',
    description: 'Add a new financial transaction. IMPORTANT: If a merchant name or a list of items is mentioned, you MUST populate the "merchant" and "items" fields specifically. Do NOT just dump them into the description.',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
      amount: z.number().describe('Total amount of the transaction'),
      type: z.enum(['INCOME', 'EXPENSE']).describe('Status as INCOME or EXPENSE'),
      category: z.string().describe('The category of the transaction (e.g., Food & Beverage, Transport, Entertainment, Shopping, Health, Utilities, Salary). If not explicitly mentioned, please categorize it yourself based on the merchant or items.'),
      description: z.string().optional().describe('General notes, but do NOT include item lists or merchant name here if those fields are available'),
      merchant: z.string().optional().describe('The store, restaurant, or person. DO NOT LEAVE NULL IF MENTIONED.'),
      items: z.array(z.object({
        name: z.string().describe('Item name'),
        price: z.number().describe('Price per unit'),
        qty: z.number().describe('Quantity'),
      })).optional().describe('Detailed list of products/services bought. USE THIS for structured receipt data.'),
    },
  })
  async addTransaction(params: any) {
    this.logger.log(`Tool add_transaction called with params: ${JSON.stringify(params)}`);
    const transaction = await this.transactionService.createTransaction(params);
    return {
      content: [
        {
          type: 'text',
          text: `Transaction added successfully: ${transaction.id} (${transaction.type} - ${transaction.amount})`,
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
          text: `Balance for ${chatId}:\n- Income: ${res.income}\n- Expense: ${res.expense}\n- Total Balance: ${res.balance}`,
        },
      ],
    };
  }

  @Tool({
    name: 'list_transactions',
    description: 'List recent transactions for a chat ID',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
      limit: z.number().optional().default(10).describe('Limit results'),
    },
  })
  async listTransactions({ chatId, limit }: { chatId: string; limit: number }) {
    this.logger.log(`Tool list_transactions called for ${chatId} (limit: ${limit})`);
    const transactions = await this.transactionService.getTransactions(chatId, limit);
    const text = transactions
      .map((t: any) => {
        let itemStr = '';
        if (t.items && Array.isArray(t.items) && t.items.length > 0) {
          const itemsPart = t.items.map((i: any) => `${i.name} (x${i.qty})`).join(', ');
          itemStr = `\n   📦 Items: ${itemsPart}`;
        }
        return `📅 ${t.date.toISOString().split('T')[0]} | ${t.type === 'INCOME' ? '💰' : '💸'} *${t.type}*\n` +
               `   🏢 ${t.merchant ?? 'Unknown'} (${t.category ?? 'N/A'})\n` +
               `   💵 Amount: Rp ${t.amount.toLocaleString('id-ID')}\n` +
               `   🆔 ID: \`${t.id.substring(0, 8)}\`${itemStr}\n`;
      })
      .join('---\n');
    
    return {
      content: [
        {
          type: 'text',
          text: text || 'No transactions found.',
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
    const t = await this.transactionService.getTransactionById(transactionId, chatId);
    
    if (!t) {
      return {
        content: [{ type: 'text', text: `Transaction with ID "${transactionId}" not found.` }],
      };
    }

    let itemStr = '';
    if (t.items && Array.isArray(t.items) && t.items.length > 0) {
      const itemsPart = t.items.map((i: any) => `${i.name} (x${i.qty})`).join(', ');
      itemStr = `\n   📦 Items: ${itemsPart}`;
    }

    const text = `📅 ${t.date.toISOString().split('T')[0]} | ${t.type === 'INCOME' ? '💰' : '💸'} *${t.type}*\n` +
                 `   🏢 ${t.merchant ?? 'Unknown'} (${t.category ?? 'N/A'})\n` +
                 `   💵 Amount: Rp ${t.amount.toLocaleString('id-ID')}\n` +
                 `   📝 Description: ${t.description || '-'}\n` +
                 `   🆔 ID: \`${t.id}\`${itemStr}`;

    return {
      content: [{ type: 'text', text }],
    };
  }
}
