import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from 'nestjs-prisma';
import { McpModule } from '@nestjs-mcp/server';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FinanceService } from './finance/finance.service';
import { FinanceResolver } from './finance/finance.resolver';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule.forRoot({
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
  providers: [AppService, FinanceService, FinanceResolver],
})
export class AppModule {}
