/**
 * @file server/modules/mcp/mcp.module.ts
 * @description MCP wiring: JSON-RPC endpoint + tool dispatch.
 * ImportService is pulled in for the import_holdings tool.
 */
import { Module } from '@nestjs/common';
import { ImportModule } from '../import/import.module';
import { PaperTradingModule } from '../paper-trading/paper-trading.module';
import { QuoteModule } from '../quote/quote.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

@Module({
  imports: [PaperTradingModule, QuoteModule, ImportModule],
  controllers: [McpController],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
