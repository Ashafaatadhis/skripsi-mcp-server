import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { OpenAIEmbeddings } from "@langchain/openai";

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getEmbedding(text: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is missing in MCP server env");

    const embeddings = new OpenAIEmbeddings({
      apiKey,
      modelName: "text-embedding-3-small",
    });

    try {
      return await embeddings.embedQuery(text);
    } catch (error) {
      this.logger.error("Failed to generate embedding with langchain:", error);
      throw error;
    }
  }

  async saveToLongTermMemory(chatId: string, content: string) {
    try {
      const vector = await this.getEmbedding(content);
      const vectorString = `[${vector.join(",")}]`;

      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "LongTermMemory" (id, "chatId", content, embedding) 
         VALUES (gen_random_uuid(), $1, $2, $3::vector)`,
        chatId,
        content,
        vectorString,
      );

      this.logger.log(`✅ Memory Berhasil Disimpan: "${content.substring(0, 20)}..."`);
      return true;
    } catch (error) {
      this.logger.error("❌ Gagal simpan ke Long Term Memory:", error);
      throw error;
    }
  }

  async searchLongTermMemory(chatId: string, query: string, limit = 3) {
    try {
      const vector = await this.getEmbedding(query);
      const vectorString = `[${vector.join(",")}]`;

      const results = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT content FROM "LongTermMemory" 
         WHERE "chatId" = $1 
         ORDER BY embedding <=> $2::vector 
         LIMIT $3`,
        chatId,
        vectorString,
        limit,
      );

      return results.map((r) => r.content).join("\n");
    } catch (error) {
      this.logger.error("❌ Gagal cari Long Term Memory:", error);
      throw error;
    }
  }
}
