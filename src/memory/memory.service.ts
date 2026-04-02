import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { OpenAIEmbeddings } from "@langchain/openai";

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private embeddings: OpenAIEmbeddings | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private getEmbeddingsClient() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is missing in MCP server env");

    if (!this.embeddings) {
      this.embeddings = new OpenAIEmbeddings({
        apiKey,
        modelName: "text-embedding-3-small",
      });
    }

    return this.embeddings;
  }

  async getEmbedding(text: string): Promise<number[]> {
    const embeddings = this.getEmbeddingsClient();

    try {
      return await embeddings.embedQuery(text);
    } catch (error) {
      this.logger.error("Failed to generate embedding with langchain:", error);
      throw error;
    }
  }

  async saveToLongTermMemory(chatId: string, content: string) {
    try {
      const normalizedContent = content.trim();
      const existingMemory = await this.prisma.longTermMemory.findFirst({
        where: {
          chatId,
          content: normalizedContent,
        },
      });

      if (existingMemory) {
        this.logger.log(`ℹ️ Memory duplikat dilewati: "${normalizedContent.substring(0, 20)}..."`);
        return false;
      }

      const vector = await this.getEmbedding(normalizedContent);
      const vectorString = `[${vector.join(",")}]`;

      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "LongTermMemory" (id, "chatId", content, embedding) 
         VALUES (gen_random_uuid(), $1, $2, $3::vector)`,
        chatId,
        normalizedContent,
        vectorString,
      );

      this.logger.log(`✅ Memory Berhasil Disimpan: "${normalizedContent.substring(0, 20)}..."`);
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
        `SELECT content, "createdAt", embedding <=> $2::vector AS distance FROM "LongTermMemory" 
         WHERE "chatId" = $1 
         ORDER BY embedding <=> $2::vector 
         LIMIT $3`,
        chatId,
        vectorString,
        limit,
      );

      const filteredResults = results.filter((result) => Number(result.distance) <= 0.9);

      return filteredResults.map((result) => ({
        content: result.content,
        createdAt: result.createdAt,
        distance: Number(result.distance),
      }));
    } catch (error) {
      this.logger.error("❌ Gagal cari Long Term Memory:", error);
      throw error;
    }
  }
}
