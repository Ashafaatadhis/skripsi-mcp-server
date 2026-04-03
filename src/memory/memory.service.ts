import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { OpenAIEmbeddings } from "@langchain/openai";

export type MemoryType = 'fact' | 'episode_summary';

type SaveMemoryInput = {
  chatId: string;
  content: string;
  memoryType: MemoryType;
  category: string;
  canonicalKey?: string;
  importanceScore?: number;
  confidence?: number;
  sourceType?: string;
  expiresAt?: Date;
};

type SaveMemoryResult =
  | { status: 'inserted'; memoryId?: string }
  | { status: 'refreshed'; memoryId: string }
  | { status: 'updated'; memoryId: string }
  | { status: 'skipped'; memoryId?: string };

type SearchMemoryResult = {
  content: string;
  createdAt: Date;
  updatedAt: Date;
  lastConfirmedAt: Date;
  distance: number;
  memoryType: MemoryType;
  category: string;
  importanceScore: number;
  mentionCount: number;
};

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

  private normalizeContent(content: string) {
    return content.trim().replace(/\s+/g, ' ');
  }

  private sanitizeScore(value: number | undefined, fallback: number) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return fallback;
    }

    return Math.max(0, Math.min(1, value));
  }

  private isSameFactValue(existingContent: string, nextContent: string) {
    return this.normalizeContent(existingContent).toLowerCase() === this.normalizeContent(nextContent).toLowerCase();
  }

  private async insertMemory(input: SaveMemoryInput, content: string) {
    const vector = await this.getEmbedding(content);
    const vectorString = `[${vector.join(",")}]`;

    const result = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "LongTermMemory" (
        id,
        "chatId",
        content,
        "memoryType",
        category,
        "canonicalKey",
        "importanceScore",
        confidence,
        "mentionCount",
        "lastConfirmedAt",
        "isActive",
        "sourceType",
        "expiresAt",
        embedding,
        "createdAt",
        "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        1,
        NOW(),
        true,
        $8,
        $9,
        $10::vector,
        NOW(),
        NOW()
      )
      RETURNING id`,
      input.chatId,
      content,
      input.memoryType,
      input.category,
      input.canonicalKey ?? null,
      this.sanitizeScore(input.importanceScore, input.memoryType === 'fact' ? 0.8 : 0.55),
      this.sanitizeScore(input.confidence, input.memoryType === 'fact' ? 0.9 : 0.7),
      input.sourceType ?? 'system_checkpoint',
      input.expiresAt ?? null,
      vectorString,
    );

    return result[0]?.id;
  }

  async saveToLongTermMemory(input: SaveMemoryInput): Promise<SaveMemoryResult> {
    try {
      const normalizedContent = this.normalizeContent(input.content);
      if (!normalizedContent) {
        return { status: 'skipped' };
      }

      if (input.memoryType === 'fact' && input.canonicalKey) {
        const existingFact = await this.prisma.longTermMemory.findUnique({
          where: {
            chatId_canonicalKey: {
              chatId: input.chatId,
              canonicalKey: input.canonicalKey,
            },
          },
        });

        if (existingFact) {
          if (this.isSameFactValue(existingFact.content, normalizedContent)) {
            await this.prisma.longTermMemory.update({
              where: { id: existingFact.id },
              data: {
                mentionCount: { increment: 1 },
                lastConfirmedAt: new Date(),
                confidence: this.sanitizeScore(input.confidence, existingFact.confidence),
                importanceScore: this.sanitizeScore(input.importanceScore, existingFact.importanceScore),
                sourceType: input.sourceType ?? existingFact.sourceType,
                expiresAt: input.expiresAt ?? existingFact.expiresAt,
                isActive: true,
              },
            });

            this.logger.log(`ℹ️ Fact direfresh: "${normalizedContent.substring(0, 40)}..."`);
            return { status: 'refreshed', memoryId: existingFact.id };
          }

          const vector = await this.getEmbedding(normalizedContent);
          const vectorString = `[${vector.join(",")}]`;
          await this.prisma.$executeRawUnsafe(
            `UPDATE "LongTermMemory"
             SET content = $2,
                 category = $3,
                 "importanceScore" = $4,
                 confidence = $5,
                 "mentionCount" = "mentionCount" + 1,
                 "lastConfirmedAt" = NOW(),
                 "sourceType" = $6,
                 "expiresAt" = $7,
                 embedding = $8::vector,
                 "isActive" = true,
                 "updatedAt" = NOW()
             WHERE id = $1`,
            existingFact.id,
            normalizedContent,
            input.category,
            this.sanitizeScore(input.importanceScore, existingFact.importanceScore),
            this.sanitizeScore(input.confidence, existingFact.confidence),
            input.sourceType ?? existingFact.sourceType,
            input.expiresAt ?? existingFact.expiresAt,
            vectorString,
          );

          this.logger.log(`♻️ Fact diupdate: "${normalizedContent.substring(0, 40)}..."`);
          return { status: 'updated', memoryId: existingFact.id };
        }
      }

      const existingEpisode =
        input.memoryType === 'episode_summary'
          ? await this.prisma.longTermMemory.findFirst({
              where: {
                chatId: input.chatId,
                memoryType: 'episode_summary',
                content: normalizedContent,
                isActive: true,
              },
              orderBy: { createdAt: 'desc' },
            })
          : null;

      if (existingEpisode) {
        await this.prisma.longTermMemory.update({
          where: { id: existingEpisode.id },
          data: {
            mentionCount: { increment: 1 },
            lastConfirmedAt: new Date(),
            importanceScore: this.sanitizeScore(input.importanceScore, existingEpisode.importanceScore),
            expiresAt: input.expiresAt ?? existingEpisode.expiresAt,
          },
        });

        this.logger.log(`ℹ️ Episode summary direfresh: "${normalizedContent.substring(0, 40)}..."`);
        return { status: 'refreshed', memoryId: existingEpisode.id };
      }

      const memoryId = await this.insertMemory(input, normalizedContent);
      this.logger.log(`✅ Memory berhasil disimpan: "${normalizedContent.substring(0, 40)}..."`);
      return { status: 'inserted', memoryId };
    } catch (error) {
      this.logger.error("❌ Gagal simpan ke Long Term Memory:", error);
      throw error;
    }
  }

  async searchLongTermMemory(chatId: string, query: string, limit = 5): Promise<SearchMemoryResult[]> {
    try {
      const vector = await this.getEmbedding(query);
      const vectorString = `[${vector.join(",")}]`;

      const results = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT content, "createdAt", "updatedAt", "lastConfirmedAt", "memoryType", category, "importanceScore", "mentionCount", embedding <=> $2::vector AS distance
         FROM "LongTermMemory" 
         WHERE "chatId" = $1
           AND "isActive" = true
           AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
         ORDER BY embedding <=> $2::vector 
         LIMIT $3`,
        chatId,
        vectorString,
        Math.max(limit * 3, limit),
      );

      const filteredResults = results
        .filter((result) => Number(result.distance) <= 0.92)
        .sort((a, b) => {
          const typeWeightA = a.memoryType === 'fact' ? 0 : 1;
          const typeWeightB = b.memoryType === 'fact' ? 0 : 1;
          if (typeWeightA !== typeWeightB) {
            return typeWeightA - typeWeightB;
          }

          const importanceDiff = Number(b.importanceScore) - Number(a.importanceScore);
          if (importanceDiff !== 0) {
            return importanceDiff;
          }

          return Number(a.distance) - Number(b.distance);
        })
        .slice(0, limit);

      return filteredResults.map((result) => ({
        content: result.content,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        lastConfirmedAt: result.lastConfirmedAt,
        distance: Number(result.distance),
        memoryType: result.memoryType,
        category: result.category,
        importanceScore: Number(result.importanceScore),
        mentionCount: Number(result.mentionCount),
      }));
    } catch (error) {
      this.logger.error("❌ Gagal cari Long Term Memory:", error);
      throw error;
    }
  }
}
