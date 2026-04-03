import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { McpModule } from '@nestjs-mcp/server';
import { ConfigModule } from '@nestjs/config';
import { TransactionService } from './transaction/transaction.service';
import { TransactionResolver } from './transaction/transaction.resolver';
import { SplitBillService } from './split-bill/split-bill.service';
import { SplitBillResolver } from './split-bill/split-bill.resolver';
import { MemoryService } from './memory/memory.service';
import { MemoryResolver } from './memory/memory.resolver';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    McpModule.forRoot({
      name: 'Finance MCP Server',
      version: '1.0.0',
      logging: {
        enabled: true,
        level: 'debug',
      },
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    TransactionService,
    TransactionResolver,
    SplitBillService,
    SplitBillResolver,
    MemoryService,
    MemoryResolver
  ],
})
export class AppModule {}
