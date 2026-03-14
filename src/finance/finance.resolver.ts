import { Resolver, Tool } from '@nestjs-mcp/server';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { FinanceService } from './finance.service';

@Resolver('finance')
export class FinanceResolver {
  private readonly logger = new Logger(FinanceResolver.name);

  constructor(private readonly financeService: FinanceService) {}

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
    const transaction = await this.financeService.createTransaction(params);
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
    const res = await this.financeService.getBalance(chatId);
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
    const transactions = await this.financeService.getTransactions(chatId, limit);
    const text = transactions
      .map((t: any) => {
        let itemStr = '';
        if (t.items && Array.isArray(t.items) && t.items.length > 0) {
          const itemsPart = t.items.map((i: any) => `${i.name} (x${i.qty})`).join(', ');
          itemStr = `\n   Items: ${itemsPart}`;
        }
        return `- [${t.date.toISOString().split('T')[0]}] ${t.type}: ${t.amount} at ${t.merchant ?? 'Unknown'} (${t.category ?? 'N/A'})${itemStr}`;
      })
      .join('\n');
    
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
    name: 'split_bill',
    description: 'Split a bill between several people. It creates a transaction for the total amount and tracks debts for participants.',
    paramsSchema: {
      chatId: z.string().describe('Unique ID for the chat or user'),
      totalAmount: z.number().describe('The total amount of the bill to be split'),
      merchant: z.string().optional().describe('Where the bill was from'),
      description: z.string().optional().describe('Common description'),
      category: z.string().describe('Category for the transaction (e.g., Food & Drink)'),
      participants: z.array(z.string()).describe('List of friends names taking part in the split (DO NOT include the user/yourself here)'),
      items: z.array(z.object({
        name: z.string().describe('Item name'),
        price: z.number().describe('Price per unit'),
        qty: z.number().describe('Quantity'),
      })).optional().describe('Detailed list of items if available (e.g. from a receipt)'),
    },
  })
  async splitBill(params: any) {
    this.logger.log(`Tool split_bill called for ${params.chatId}`);
    
    // 1. Create the main transaction for the full amount
    const transaction = await this.financeService.createTransaction({
      chatId: params.chatId,
      amount: params.totalAmount,
      type: 'EXPENSE',
      category: params.category,
      description: params.description || `Split bill at ${params.merchant || 'Merchant'}`,
      merchant: params.merchant,
      items: params.items,
    });

    // 2. Calculate the split (Total / (Me + Participants))
    // We assume the caller (AI) only listed the friends, not the user themselves.
    const share = params.totalAmount / (params.participants.length + 1);

    // 3. Create debt entries for each participant
    const debtPromises = params.participants.map((person: string) => 
      this.financeService.createDebt({
        chatId: params.chatId,
        personName: person,
        amount: share,
        description: `Split from ${params.merchant || 'Transaction'}`,
        transactionId: transaction.id,
      })
    );

    await Promise.all(debtPromises);

    return {
      content: [
        {
          type: 'text',
          text: `Bill of ${params.totalAmount} at ${params.merchant || 'Merchant'} split successfully among ${params.participants.length + 1} people (you + ${params.participants.join(', ')}). Each person owes you ${share.toFixed(2)}.`,
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

    const debts = await this.financeService.getDebts(chatId, isPaid);
    
    const text = debts
      .map((d: any) => `- [${d.isPaid ? 'PAID' : 'OWED'}] ${d.personName}: ${d.amount} (ID: ${d.id.substring(0,8)}) - ${d.description || ''}`)
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: text || 'No debt records found.',
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
      const settledDebt = await this.financeService.settleDebt(debtId, chatId);
      
      // Otomatis catat sebagai INCOME agar saldo akurat
      await this.financeService.createTransaction({
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
}
